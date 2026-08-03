import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { lambdaHandler } from '../../app';

// `uuid@13` ships ESM-only (no CJS build) — Jest's default CommonJS require() can't load it.
jest.mock('uuid', () => ({ v4: () => 'mocked-promo-uuid' }));

const ddbMock = mockClient(DynamoDBClient);

const ALLOWED_ORIGIN = 'http://localhost:3003';

function buildEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
    return {
        httpMethod: 'GET',
        path: '/promo-codes',
        headers: {
            origin: ALLOWED_ORIGIN,
            cookie: 'Authentication=fake-token; Identifier=fake-uid',
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

const samplePromoItem = {
    PK: 'PROMO',
    SK: 'META#33333333-3333-4333-8333-333333333333',
    uuid: '33333333-3333-4333-8333-333333333333',
    code: 'LAUNCH50',
    type: 'percentage',
    value: 20,
    redemption_count: 0,
    status: 'active',
    created_by: 'staff-1',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
    ddbMock.reset();
});

describe('GET /promo-codes', () => {
    it('returns 200 with the promo code list', async () => {
        ddbMock.on(QueryCommand).resolves({ Items: [samplePromoItem] });

        const res = await lambdaHandler(buildEvent({ httpMethod: 'GET', path: '/promo-codes' }));

        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body).toHaveLength(1);
        expect(body[0]).toMatchObject({ uuid: '33333333-3333-4333-8333-333333333333', code: 'LAUNCH50', max_redemptions: null, expires_at: null });
    });

    it('returns 401 when unauthenticated', async () => {
        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'GET', path: '/promo-codes', headers: { origin: ALLOWED_ORIGIN } }),
        );

        expect(res.statusCode).toBe(401);
    });
});

describe('POST /promo-codes', () => {
    const validBody = {
        code: 'launch50',
        type: 'percentage',
        value: 20,
        created_by: 'staff-1',
    };

    it('creates a promo code (uppercasing the code) and returns 201', async () => {
        ddbMock.on(TransactWriteCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'POST', path: '/promo-codes', body: JSON.stringify(validBody) }),
        );

        expect(res.statusCode).toBe(201);
        const body = JSON.parse(res.body);
        expect(body.code).toBe('LAUNCH50');
        expect(body.max_redemptions).toBeNull();
        expect(body.redemption_count).toBe(0);
        expect(body.status).toBe('active');

        // max_redemptions/expires_at must be OMITTED from the written item entirely (not stored as
        // DynamoDB NULL) — the redemption ConditionExpression's attribute_not_exists() checks rely
        // on that for "unlimited"/"never expires".
        const call = ddbMock.commandCalls(TransactWriteCommand)[0];
        const metaItem = call.args[0].input.TransactItems?.find((item) => item.Put?.Item?.SK === 'META#mocked-promo-uuid');
        expect(metaItem?.Put?.Item).not.toHaveProperty('max_redemptions');
        expect(metaItem?.Put?.Item).not.toHaveProperty('expires_at');
    });

    it('rejects a percentage code with value over 100', async () => {
        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'POST',
                path: '/promo-codes',
                body: JSON.stringify({ ...validBody, value: 150 }),
            }),
        );

        expect(res.statusCode).toBe(400);
        expect(ddbMock).not.toHaveReceivedCommand(TransactWriteCommand);
    });

    it('returns 400 when required fields are missing', async () => {
        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'POST', path: '/promo-codes', body: JSON.stringify({}) }),
        );

        expect(res.statusCode).toBe(400);
        expect(ddbMock).not.toHaveReceivedCommand(TransactWriteCommand);
    });

    it('returns 409 when the code already exists', async () => {
        ddbMock.on(TransactWriteCommand).rejects(
            new TransactionCanceledException({
                message: 'Transaction cancelled',
                $metadata: {},
                CancellationReasons: [{ Code: 'ConditionalCheckFailed' }],
            }),
        );

        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'POST', path: '/promo-codes', body: JSON.stringify(validBody) }),
        );

        expect(res.statusCode).toBe(409);
    });
});

describe('PATCH /promo-codes', () => {
    it('disables a promo code', async () => {
        ddbMock.on(GetCommand, { Key: { PK: 'PROMO', SK: 'META#33333333-3333-4333-8333-333333333333' } }).resolves({ Item: samplePromoItem });
        ddbMock.on(UpdateCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'PATCH',
                path: '/promo-codes',
                body: JSON.stringify({ uuid: '33333333-3333-4333-8333-333333333333', status: 'disabled' }),
            }),
        );

        expect(res.statusCode).toBe(200);
        expect(ddbMock).toHaveReceivedCommandWith(UpdateCommand, {
            Key: { PK: 'PROMO', SK: 'META#33333333-3333-4333-8333-333333333333' },
        });
    });

    it('returns 404 when the promo code does not exist', async () => {
        ddbMock.on(GetCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'PATCH',
                path: '/promo-codes',
                body: JSON.stringify({ uuid: '99999999-9999-4999-8999-999999999999', status: 'disabled' }),
            }),
        );

        expect(res.statusCode).toBe(404);
    });
});

describe('GET /promo-codes/by-id', () => {
    it('returns a promo code by uuid', async () => {
        ddbMock.on(GetCommand, { Key: { PK: 'PROMO', SK: 'META#33333333-3333-4333-8333-333333333333' } }).resolves({ Item: samplePromoItem });

        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'GET', path: '/promo-codes/by-id', queryStringParameters: { id: '33333333-3333-4333-8333-333333333333' } }),
        );

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).uuid).toBe('33333333-3333-4333-8333-333333333333');
    });

    it('returns 404 for an unknown uuid', async () => {
        ddbMock.on(GetCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'GET', path: '/promo-codes/by-id', queryStringParameters: { id: 'nonexistent' } }),
        );

        expect(res.statusCode).toBe(404);
    });
});

describe('DELETE /promo-codes/by-id', () => {
    it('deletes a never-redeemed promo code', async () => {
        ddbMock.on(GetCommand, { Key: { PK: 'PROMO', SK: 'META#33333333-3333-4333-8333-333333333333' } }).resolves({ Item: samplePromoItem });
        ddbMock.on(TransactWriteCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'DELETE',
                path: '/promo-codes/by-id',
                queryStringParameters: { id: '33333333-3333-4333-8333-333333333333' },
            }),
        );

        expect(res.statusCode).toBe(200);
    });

    it('returns 409 when the promo code has already been redeemed', async () => {
        ddbMock
            .on(GetCommand, { Key: { PK: 'PROMO', SK: 'META#33333333-3333-4333-8333-333333333333' } })
            .resolves({ Item: { ...samplePromoItem, redemption_count: 3 } });

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'DELETE',
                path: '/promo-codes/by-id',
                queryStringParameters: { id: '33333333-3333-4333-8333-333333333333' },
            }),
        );

        expect(res.statusCode).toBe(409);
        expect(ddbMock).not.toHaveReceivedCommand(TransactWriteCommand);
    });

    it('returns 404 for an unknown uuid', async () => {
        ddbMock.on(GetCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'DELETE',
                path: '/promo-codes/by-id',
                queryStringParameters: { id: 'nonexistent' },
            }),
        );

        expect(res.statusCode).toBe(404);
    });
});
