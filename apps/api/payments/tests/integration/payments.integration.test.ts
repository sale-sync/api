import 'aws-sdk-client-mock-jest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { Plan, Subscription } from '@sale-sync/shared/src/types';
import { lambdaHandler } from '../../app';

// Exercises the real Lambda handler (router + controllers + services) end to end, with
// DynamoDB mocked at the SDK client boundary rather than mocking our own service classes —
// this is what makes it an integration test rather than a unit test: it proves the router
// wiring, controller validation, and DynamoDB key/marshalling shape all actually work together.
const ddbMock = mockClient(DynamoDBClient);

const ALLOWED_ORIGIN = 'http://localhost:3000';

function buildEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
    return {
        httpMethod: 'GET',
        path: '/payments',
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

const samplePlan: Plan = {
    uuid: 'plan-uuid-1',
    plan_id: 'basic',
    name: 'Basic',
    info: 'The basic tier',
    included: ['feature-a', 'feature-b'],
    price: 240,
    currency: 'USD',
    billing_interval: 'yearly',
};

const sampleSubscription: Subscription = {
    uuid: 'sub-uuid-1',
    organisation_id: 'org-1',
    plan_id: 'basic',
    trial_start: '2026-01-01T00:00:00.000Z',
    trial_end: '2026-01-15T00:00:00.000Z',
    status: 'trialing',
    payment_method: null,
    activated_by: null,
    activated_at: null,
    promo_code: null,
    discount_type: null,
    discount_value: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
    ddbMock.reset();
});

describe('GET /payments', () => {
    it('returns 200 with the plan catalogue', async () => {
        ddbMock.on(QueryCommand).resolves({ Items: [{ data: JSON.stringify(samplePlan) }] });

        const res = await lambdaHandler(buildEvent({ httpMethod: 'GET', path: '/payments' }));

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual([samplePlan]);
        expect(ddbMock).toHaveReceivedCommandWith(QueryCommand, {
            TableName: 'sale-sync-organisation',
            KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
            ExpressionAttributeValues: { ':pk': 'PLAN', ':prefix': 'META#' },
        });
    });

    it('returns 401 when the request has no auth cookies', async () => {
        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'GET', path: '/payments', headers: { origin: ALLOWED_ORIGIN } }),
        );

        expect(res.statusCode).toBe(401);
        expect(ddbMock).not.toHaveReceivedCommand(QueryCommand);
    });
});

describe('GET /payments/by-id', () => {
    it('resolves a plan by its slug', async () => {
        ddbMock
            .on(GetCommand, { Key: { PK: 'PLAN#ID#basic', SK: 'META' } })
            .resolves({ Item: { uuid: samplePlan.uuid } })
            .on(GetCommand, { Key: { PK: 'PLAN', SK: `META#${samplePlan.uuid}` } })
            .resolves({ Item: { data: JSON.stringify(samplePlan) } });

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'GET',
                path: '/payments/by-id',
                queryStringParameters: { id: 'basic' },
            }),
        );

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual(samplePlan);
    });

    it('returns 404 for an unknown slug', async () => {
        ddbMock.on(GetCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'GET',
                path: '/payments/by-id',
                queryStringParameters: { id: 'nonexistent' },
            }),
        );

        expect(res.statusCode).toBe(404);
    });

    it('returns 400 when the id query parameter is missing', async () => {
        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'GET', path: '/payments/by-id', queryStringParameters: null }),
        );

        expect(res.statusCode).toBe(400);
        expect(ddbMock).not.toHaveReceivedCommand(GetCommand);
    });
});

describe('GET /payments/subscription', () => {
    it("returns the organisation's subscription/trial record", async () => {
        ddbMock
            .on(GetCommand, { Key: { PK: 'ORG#org-1', SK: 'SUBSCRIPTION' } })
            .resolves({ Item: { data: JSON.stringify(sampleSubscription) } });

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'GET',
                path: '/payments/subscription',
                queryStringParameters: { organisation_id: 'org-1' },
            }),
        );

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual(sampleSubscription);
    });

    it('returns 404 when the organisation has no subscription record', async () => {
        ddbMock.on(GetCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'GET',
                path: '/payments/subscription',
                queryStringParameters: { organisation_id: 'org-unknown' },
            }),
        );

        expect(res.statusCode).toBe(404);
    });

    it('returns 400 when the organisation_id query parameter is missing', async () => {
        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'GET', path: '/payments/subscription', queryStringParameters: null }),
        );

        expect(res.statusCode).toBe(400);
    });
});

describe('CORS', () => {
    it('echoes back an allowed origin on a normal response', async () => {
        ddbMock.on(QueryCommand).resolves({ Items: [] });

        const res = await lambdaHandler(buildEvent({ httpMethod: 'GET', path: '/payments' }));

        expect(res.headers?.['Access-Control-Allow-Origin']).toBe(ALLOWED_ORIGIN);
    });

    it('short-circuits an OPTIONS preflight request with 204', async () => {
        const res = await lambdaHandler(buildEvent({ httpMethod: 'OPTIONS', path: '/payments' }));

        expect(res.statusCode).toBe(204);
        expect(ddbMock).not.toHaveReceivedCommand(QueryCommand);
    });
});
