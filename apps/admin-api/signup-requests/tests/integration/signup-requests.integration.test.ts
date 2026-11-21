import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { SignupRequest } from '@sale-sync/shared/src/types';
import { lambdaHandler } from '../../app';

// `uuid@13` ships ESM-only — same Jest CJS stub used by api/apps/api/organisation's suite. Not
// asserting on the generated uuid's exact value anywhere, so a fixed mock is sufficient.
jest.mock('uuid', () => ({ v4: () => 'mocked-org-uuid' }));

const ddbMock = mockClient(DynamoDBClient);

const ALLOWED_ORIGIN = 'http://localhost:3003';

// jwt-decode only base64url-decodes the payload segment — no signature verification — so a
// well-formed-looking but unsigned token is sufficient for isAuthorize()/getUser().
function fakeJwt(payload: Record<string, unknown>): string {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${header}.${body}.fake-signature`;
}

const REVIEWER_ID = 'staff-1';

function buildEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
    const identifierJwt = fakeJwt({ sub: REVIEWER_ID, name: 'Staff Reviewer', email: 'staff@salesync.biz', email_verified: true });
    return {
        httpMethod: 'GET',
        path: '/signup-requests',
        headers: {
            origin: ALLOWED_ORIGIN,
            cookie: `Authentication=fake-token; Identifier=${identifierJwt}`,
        },
        multiValueHeaders: {},
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        pathParameters: null,
        stageVariables: null,
        requestContext: {} as APIGatewayProxyEvent['requestContext'],
        resource: '',
        body: null,
        isBase64Encoded: false,
        ...overrides,
    };
}

const sampleRequest: SignupRequest = {
    uuid: '33333333-3333-4333-8333-333333333333',
    organisation_id: 'potato-rocket',
    organisation_name: 'Potato Rocket',
    business_category: 'service-business',
    template_id: '11111111-1111-4111-8111-111111111111',
    plan_id: '22222222-2222-4222-8222-222222222222',
    market: 'AU',
    status: 'pending',
    requested_by_user_id: 'user-1',
    requested_by_email: 'user@example.com',
    created_at: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
    ddbMock.reset();
    process.env.ORGANISATION_TABLE_NAME = 'sale-sync-organisation';
});

describe('GET /signup-requests', () => {
    it('returns the pending queue by default', async () => {
        ddbMock.on(QueryCommand).resolves({ Items: [{ data: JSON.stringify(sampleRequest) }] });

        const res = await lambdaHandler(buildEvent({ httpMethod: 'GET', path: '/signup-requests' }));

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ items: [sampleRequest] });
        expect(ddbMock).toHaveReceivedCommandWith(QueryCommand, {
            IndexName: 'trial-status-index',
            ExpressionAttributeValues: { ':pk': 'SIGNUP#PENDING' },
        });
    });

    it('returns 401 when unauthenticated', async () => {
        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'GET', path: '/signup-requests', headers: { origin: ALLOWED_ORIGIN } }),
        );

        expect(res.statusCode).toBe(401);
    });
});

describe('GET /signup-requests/by-id', () => {
    it('resolves a signup request by uuid', async () => {
        ddbMock
            .on(GetCommand, { Key: { PK: 'SIGNUP', SK: `META#${sampleRequest.uuid}` } })
            .resolves({ Item: { data: JSON.stringify(sampleRequest) } });

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'GET',
                path: '/signup-requests/by-id',
                queryStringParameters: { id: sampleRequest.uuid },
            }),
        );

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual(sampleRequest);
    });

    it('returns 404 for an unknown uuid', async () => {
        ddbMock.on(GetCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'GET',
                path: '/signup-requests/by-id',
                queryStringParameters: { id: 'nonexistent' },
            }),
        );

        expect(res.statusCode).toBe(404);
    });
});

describe('PATCH /signup-requests/by-id', () => {
    it('approves a pending request, creates the organisation, and flips status', async () => {
        ddbMock
            .on(GetCommand, { Key: { PK: 'SIGNUP', SK: `META#${sampleRequest.uuid}` } })
            .resolves({ Item: { data: JSON.stringify(sampleRequest) } });
        ddbMock.on(TransactWriteCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'PATCH',
                path: '/signup-requests/by-id',
                body: JSON.stringify({ uuid: sampleRequest.uuid, action: 'approve' }),
            }),
        );

        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.message).toBe('Signup request approved');
        expect(body.organisation.id).toBe(sampleRequest.organisation_id);
        expect(body.organisation.status).toBe('ready'); // service-business skips website provisioning
        // One TransactWriteCommand for org creation, one for the signup-request status flip + dedup-lock delete.
        expect(ddbMock).toHaveReceivedCommandTimes(TransactWriteCommand, 2);
    });

    it('rejects a pending request with a reason', async () => {
        ddbMock
            .on(GetCommand, { Key: { PK: 'SIGNUP', SK: `META#${sampleRequest.uuid}` } })
            .resolves({ Item: { data: JSON.stringify(sampleRequest) } });
        ddbMock.on(TransactWriteCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'PATCH',
                path: '/signup-requests/by-id',
                body: JSON.stringify({ uuid: sampleRequest.uuid, action: 'reject', rejection_reason: 'Duplicate signup' }),
            }),
        );

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ message: 'Signup request rejected' });
        expect(ddbMock).toHaveReceivedCommandTimes(TransactWriteCommand, 1);
    });

    it('returns 400 when rejecting without a rejection_reason', async () => {
        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'PATCH',
                path: '/signup-requests/by-id',
                body: JSON.stringify({ uuid: sampleRequest.uuid, action: 'reject' }),
            }),
        );

        expect(res.statusCode).toBe(400);
    });

    it('returns 409 when the request has already been actioned', async () => {
        ddbMock
            .on(GetCommand, { Key: { PK: 'SIGNUP', SK: `META#${sampleRequest.uuid}` } })
            .resolves({ Item: { data: JSON.stringify({ ...sampleRequest, status: 'approved' }) } });

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'PATCH',
                path: '/signup-requests/by-id',
                body: JSON.stringify({ uuid: sampleRequest.uuid, action: 'approve' }),
            }),
        );

        expect(res.statusCode).toBe(409);
    });

    it('"banana": approves a previously-rejected request — reject then approve is a valid reversal', async () => {
        const rejectedRequest: SignupRequest = {
            ...sampleRequest,
            status: 'rejected',
            rejection_reason: 'Duplicate signup',
            reviewed_by_user_id: 'staff-0',
            reviewed_at: '2026-01-02T00:00:00.000Z',
        };
        ddbMock
            .on(GetCommand, { Key: { PK: 'SIGNUP', SK: `META#${sampleRequest.uuid}` } })
            .resolves({ Item: { data: JSON.stringify(rejectedRequest) } });
        ddbMock.on(TransactWriteCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'PATCH',
                path: '/signup-requests/by-id',
                body: JSON.stringify({ uuid: sampleRequest.uuid, action: 'approve' }),
            }),
        );

        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.message).toBe('Signup request approved');
        expect(body.organisation.id).toBe(sampleRequest.organisation_id);

        // Second TransactWriteCommand call is the status-flip: sets Approved=true and clears GSI2PK.
        const statusFlipCall = ddbMock.commandCalls(TransactWriteCommand)[1];
        const updateItem = statusFlipCall.args[0].input.TransactItems?.[0];
        expect(updateItem?.Update?.ConditionExpression).toBe('attribute_not_exists(Approved)');
        expect(updateItem?.Update?.ExpressionAttributeValues?.[':approved']).toBe(true);
    });

    it('"apple": returns 409 rejecting a request whose organisation was already approved/created', async () => {
        ddbMock
            .on(GetCommand, { Key: { PK: 'SIGNUP', SK: `META#${sampleRequest.uuid}` } })
            .resolves({
                Item: {
                    data: JSON.stringify({
                        ...sampleRequest,
                        status: 'approved',
                        resulting_organisation_uuid: 'mocked-org-uuid',
                        reviewed_by_user_id: 'staff-0',
                        reviewed_at: '2026-01-02T00:00:00.000Z',
                    }),
                },
            });

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'PATCH',
                path: '/signup-requests/by-id',
                body: JSON.stringify({ uuid: sampleRequest.uuid, action: 'reject', rejection_reason: 'Dispute raised' }),
            }),
        );

        expect(res.statusCode).toBe(409);
        // Freezing an already-created organisation is a separate action (PATCH /organisations/by-id in
        // api/apps/admin-api/organisation), not this endpoint — no TransactWriteCommand should fire here.
        expect(ddbMock).not.toHaveReceivedCommand(TransactWriteCommand);
    });

    it('returns 404 for an unknown uuid', async () => {
        ddbMock.on(GetCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'PATCH',
                path: '/signup-requests/by-id',
                body: JSON.stringify({ uuid: '99999999-9999-4999-8999-999999999999', action: 'approve' }),
            }),
        );

        expect(res.statusCode).toBe(404);
    });

    it('returns 409 when a concurrent action wins the race after the pending check (approve)', async () => {
        // assertPending()'s read still sees 'pending' (no race there) — the race is caught by the
        // status-flip TransactWriteCommand's ConditionExpression instead, simulating a second PATCH
        // that actioned this same uuid in between the read and this write. First TransactWriteCommand
        // call is org creation (must succeed, unrelated to the race) — only the second call (the
        // status-flip) hits the race.
        ddbMock
            .on(GetCommand, { Key: { PK: 'SIGNUP', SK: `META#${sampleRequest.uuid}` } })
            .resolves({ Item: { data: JSON.stringify(sampleRequest) } });
        ddbMock
            .on(TransactWriteCommand)
            .resolvesOnce({})
            .rejects(
                new TransactionCanceledException({
                    message: 'Transaction cancelled',
                    $metadata: {},
                    CancellationReasons: [{ Code: 'ConditionalCheckFailed' }, { Code: 'None' }],
                }),
            );

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'PATCH',
                path: '/signup-requests/by-id',
                body: JSON.stringify({ uuid: sampleRequest.uuid, action: 'approve' }),
            }),
        );

        expect(res.statusCode).toBe(409);
    });

    it('returns 409 when a concurrent action wins the race after the pending check (reject)', async () => {
        ddbMock
            .on(GetCommand, { Key: { PK: 'SIGNUP', SK: `META#${sampleRequest.uuid}` } })
            .resolves({ Item: { data: JSON.stringify(sampleRequest) } });
        ddbMock.on(TransactWriteCommand).rejects(
            new TransactionCanceledException({
                message: 'Transaction cancelled',
                $metadata: {},
                CancellationReasons: [{ Code: 'ConditionalCheckFailed' }, { Code: 'None' }],
            }),
        );

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'PATCH',
                path: '/signup-requests/by-id',
                body: JSON.stringify({ uuid: sampleRequest.uuid, action: 'reject', rejection_reason: 'Duplicate signup' }),
            }),
        );

        expect(res.statusCode).toBe(409);
    });
});
