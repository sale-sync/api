import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { BatchGetCommand, GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { Organisation } from '@sale-sync/shared/src/types';
import { lambdaHandler } from '../../app';

// `uuid@13` ships ESM-only (no CJS build), which Jest's default CommonJS `require()` can't load —
// production bundling works fine (esbuild statically bundles it), but Jest needs a stub. We don't
// assert on the generated uuid's exact value anywhere, so a fixed mock is sufficient.
jest.mock('uuid', () => ({ v4: () => 'mocked-org-uuid' }));

// Covers the two highest-traffic controllers (default: list/create, by-id: lookup) and profile's
// `name` field (BR-32) — the rest of team/profile/branding/templates/theme aren't covered yet (same
// scope boundary as the payments/auth suites: core flows first, not every sub-resource in one
// pass). BR-31 agent-designation coverage now lives in apps/api/agents/tests/integration/ instead
// (the standalone Agent entity replaced the old team-agent boolean flag).
const ddbMock = mockClient(DynamoDBClient);

const ALLOWED_ORIGIN = 'http://localhost:3000';

// jwt-decode only base64url-decodes the payload segment — no signature verification — so a
// well-formed-looking but unsigned token is sufficient for isAuthorize()/getUser()/getOrganisation().
function fakeJwt(payload: Record<string, unknown>): string {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${header}.${body}.fake-signature`;
}

const USER_ID = 'user-1';
const USER_EMAIL = 'user@example.com';

function buildEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
    const identifierJwt = fakeJwt({ sub: USER_ID, name: 'Test User', email: USER_EMAIL, email_verified: true });
    return {
        httpMethod: 'GET',
        path: '/organisations',
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

const sampleOrg: Organisation = {
    uuid: 'org-uuid-1',
    id: 'potato-rocket',
    name: 'Potato Rocket',
    status: 'ready',
    image: null,
    business_category: 'service-business',
    template_id: '11111111-1111-4111-8111-111111111111',
    plan_id: '22222222-2222-4222-8222-222222222222',
    created_at: '2026-01-01T00:00:00.000Z',
    address: null,
    market: 'AU',
};

beforeEach(() => {
    ddbMock.reset();
    // signup-request.service.ts has no hardcoded fallback (unlike organisation.service.ts's
    // pre-existing one) — see backlogs/onboarding/children/organisation-approval-gate.
    process.env.ORGANISATION_TABLE_NAME = 'sale-sync-organisation';
});

describe('GET /organisations', () => {
    it("returns 200 with the caller's organisations", async () => {
        ddbMock.on(QueryCommand).resolves({ Items: [{ PK: `ORG#${sampleOrg.uuid}` }] });
        ddbMock.on(BatchGetCommand).resolves({
            Responses: { 'sale-sync-organisation': [{ data: JSON.stringify(sampleOrg) }] },
        });

        const res = await lambdaHandler(buildEvent({ httpMethod: 'GET', path: '/organisations' }));

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual([sampleOrg]);
    });

    it('returns 401 when unauthenticated', async () => {
        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'GET', path: '/organisations', headers: { origin: ALLOWED_ORIGIN } }),
        );

        expect(res.statusCode).toBe(401);
    });
});

describe('POST /organisations (backlogs/onboarding/children/organisation-approval-gate)', () => {
    const validBody = {
        organisation_id: 'potato-rocket',
        organisation_name: 'Potato Rocket',
        business_category: 'service-business',
        template_id: '11111111-1111-4111-8111-111111111111',
        plan_id: '22222222-2222-4222-8222-222222222222',
    };

    it('creates a pending signup request and returns 202 (no live org created)', async () => {
        ddbMock.on(TransactWriteCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'POST', path: '/organisations', body: JSON.stringify(validBody) }),
        );

        expect(res.statusCode).toBe(202);
        expect(JSON.parse(res.body)).toEqual({
            signup_request_id: 'mocked-org-uuid',
            organisation_id: 'potato-rocket',
            organisation_name: 'Potato Rocket',
            status: 'pending',
        });

        const call = ddbMock.commandCalls(TransactWriteCommand)[0];
        const items = call.args[0].input.TransactItems ?? [];
        expect(items).toHaveLength(3);
        expect(items[0].Put?.Item?.PK).toBe('SIGNUP');
        expect(items[0].Put?.Item?.GSI2PK).toBe('SIGNUP#PENDING');
        expect(items[1].Put?.Item?.PK).toBe(`SIGNUP#ID#${validBody.organisation_id}`);
        expect(items[2].Put?.Item?.PK).toBe('SIGNUP#mocked-org-uuid');
        expect(items[2].Put?.Item?.SK).toBe(`USER#${USER_ID}`);
    });

    it('returns 400 when required fields are missing', async () => {
        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'POST', path: '/organisations', body: JSON.stringify({}) }),
        );

        expect(res.statusCode).toBe(400);
        expect(ddbMock).not.toHaveReceivedCommand(TransactWriteCommand);
    });

    it('returns 409 when a pending request for the organisation_id already exists', async () => {
        ddbMock.on(TransactWriteCommand).rejects(
            new TransactionCanceledException({
                message: 'Transaction cancelled',
                $metadata: {},
                CancellationReasons: [{ Code: 'None' }, { Code: 'ConditionalCheckFailed' }],
            }),
        );

        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'POST', path: '/organisations', body: JSON.stringify(validBody) }),
        );

        expect(res.statusCode).toBe(409);
    });
});

describe('GET /organisations/by-id', () => {
    it('resolves an organisation by its id slug', async () => {
        ddbMock
            .on(GetCommand, { Key: { PK: `ORG#ID#${sampleOrg.id}`, SK: 'META' } })
            .resolves({ Item: { data: JSON.stringify({ uuid: sampleOrg.uuid }) } })
            .on(GetCommand, { Key: { PK: 'ORG', SK: `META#${sampleOrg.uuid}` } })
            .resolves({ Item: { data: JSON.stringify(sampleOrg) } });

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'GET',
                path: '/organisations/by-id',
                queryStringParameters: { id: sampleOrg.id },
            }),
        );

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual(sampleOrg);
    });

    it('returns 404 for an unknown id', async () => {
        ddbMock.on(GetCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'GET',
                path: '/organisations/by-id',
                queryStringParameters: { id: 'nonexistent' },
            }),
        );

        expect(res.statusCode).toBe(404);
    });

    it('returns 400 when the id query parameter is missing', async () => {
        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'GET', path: '/organisations/by-id', queryStringParameters: null }),
        );

        expect(res.statusCode).toBe(400);
    });
});

describe('GET /organisations/signup-requests', () => {
    it("returns the caller's own signup requests via the inverted-index", async () => {
        const sampleRequest = {
            uuid: 'mocked-org-uuid',
            organisation_id: 'potato-rocket',
            organisation_name: 'Potato Rocket',
            business_category: 'service-business',
            template_id: '11111111-1111-4111-8111-111111111111',
            plan_id: '22222222-2222-4222-8222-222222222222',
            market: 'AU',
            status: 'pending',
            requested_by_user_id: USER_ID,
            requested_by_email: USER_EMAIL,
            created_at: '2026-01-01T00:00:00.000Z',
        };
        ddbMock.on(QueryCommand).resolves({ Items: [{ PK: `SIGNUP#${sampleRequest.uuid}` }] });
        ddbMock.on(BatchGetCommand).resolves({
            Responses: { 'sale-sync-organisation': [{ data: JSON.stringify(sampleRequest) }] },
        });

        const res = await lambdaHandler(buildEvent({ httpMethod: 'GET', path: '/organisations/signup-requests' }));

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual([sampleRequest]);
    });

    it('returns 401 when unauthenticated', async () => {
        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'GET', path: '/organisations/signup-requests', headers: { origin: ALLOWED_ORIGIN } }),
        );

        expect(res.statusCode).toBe(401);
    });
});

describe('GET/PATCH /organisations/profile — name field (backlogs/real-estate-agents/children/agent-public-profile)', () => {
    function buildProfileEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
        const identifierJwt = fakeJwt({ sub: USER_ID, name: 'Test User', email: USER_EMAIL, email_verified: true });
        const organisationJwt = fakeJwt({ organisation_id: sampleOrg.id, user_id: USER_ID, uuid: sampleOrg.uuid });
        return buildEvent({
            path: '/organisations/profile',
            headers: {
                origin: ALLOWED_ORIGIN,
                cookie: `Authentication=fake-token; Identifier=${identifierJwt}; Organisation=${organisationJwt}`,
            },
            ...overrides,
        });
    }

    it('GET falls back to the Cognito name when no name has been persisted', async () => {
        ddbMock
            .on(GetCommand, { Key: { PK: `ORG#${sampleOrg.uuid}`, SK: `USER#${USER_ID}` } })
            .resolves({ Item: { data: JSON.stringify({ role: 'staff', joined_date: '2026-01-01T00:00:00.000Z' }) } });

        const res = await lambdaHandler(buildProfileEvent({ httpMethod: 'GET' }));

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).name).toBe('Test User');
    });

    it('GET prefers the persisted name once one has been set', async () => {
        ddbMock.on(GetCommand, { Key: { PK: `ORG#${sampleOrg.uuid}`, SK: `USER#${USER_ID}` } }).resolves({
            Item: { data: JSON.stringify({ role: 'staff', joined_date: '2026-01-01T00:00:00.000Z', name: 'Nichapa Suksawat' }) },
        });

        const res = await lambdaHandler(buildProfileEvent({ httpMethod: 'GET' }));

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).name).toBe('Nichapa Suksawat');
    });

    it('PATCH persists a new name', async () => {
        ddbMock
            .on(GetCommand, { Key: { PK: `ORG#${sampleOrg.uuid}`, SK: `USER#${USER_ID}` } })
            .resolves({ Item: { data: JSON.stringify({ role: 'staff', joined_date: '2026-01-01T00:00:00.000Z' }) } });

        const res = await lambdaHandler(
            buildProfileEvent({ httpMethod: 'PATCH', body: JSON.stringify({ name: 'Nichapa Suksawat' }) }),
        );

        expect(res.statusCode).toBe(200);
        expect(ddbMock).toHaveReceivedCommandWith(UpdateCommand, {
            Key: { PK: `ORG#${sampleOrg.uuid}`, SK: `USER#${USER_ID}` },
            ExpressionAttributeValues: {
                ':data': JSON.stringify({ role: 'staff', joined_date: '2026-01-01T00:00:00.000Z', name: 'Nichapa Suksawat' }),
            },
        });
    });

    it('returns 401 when unauthenticated', async () => {
        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'GET', path: '/organisations/profile', headers: { origin: ALLOWED_ORIGIN } }),
        );

        expect(res.statusCode).toBe(401);
    });
});
