import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { Plan, Subscription } from '@sale-sync/shared/src/types';
import { lambdaHandler } from '../../app';

// `uuid@13` ships ESM-only (no CJS build) — Jest's default CommonJS require() can't load it.
jest.mock('uuid', () => ({ v4: () => 'mocked-plan-uuid' }));

const ddbMock = mockClient(DynamoDBClient);

const ALLOWED_ORIGIN = 'http://localhost:3003';

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
    uuid: '44444444-4444-4444-8444-444444444444',
    plan_id: 'basic',
    name: 'Basic',
    info: 'The basic tier',
    included: ['feature-a'],
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
    });

    it('returns 401 when unauthenticated', async () => {
        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'GET', path: '/payments', headers: { origin: ALLOWED_ORIGIN } }),
        );

        expect(res.statusCode).toBe(401);
    });
});

describe('POST /payments', () => {
    const validBody = {
        plan_id: 'pro',
        name: 'Pro',
        info: 'The pro tier',
        included: ['feature-a', 'feature-b'],
        price: 600,
        currency: 'USD',
        billing_interval: 'yearly',
    };

    it('creates a plan and returns 201', async () => {
        ddbMock.on(TransactWriteCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'POST', path: '/payments', body: JSON.stringify(validBody) }),
        );

        expect(res.statusCode).toBe(201);
        expect(JSON.parse(res.body)).toEqual({ message: 'Plan created', uuid: 'mocked-plan-uuid' });
    });

    it('returns 400 when required fields are missing', async () => {
        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'POST', path: '/payments', body: JSON.stringify({}) }),
        );

        expect(res.statusCode).toBe(400);
        expect(ddbMock).not.toHaveReceivedCommand(TransactWriteCommand);
    });

    it('returns 409 when the plan_id already exists', async () => {
        ddbMock.on(TransactWriteCommand).rejects(
            new TransactionCanceledException({
                message: 'Transaction cancelled',
                $metadata: {},
                CancellationReasons: [{ Code: 'ConditionalCheckFailed' }],
            }),
        );

        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'POST', path: '/payments', body: JSON.stringify(validBody) }),
        );

        expect(res.statusCode).toBe(409);
    });
});

describe('PATCH /payments', () => {
    it('updates an existing plan', async () => {
        ddbMock
            .on(GetCommand, { Key: { PK: 'PLAN', SK: `META#${samplePlan.uuid}` } })
            .resolves({ Item: { data: JSON.stringify(samplePlan) } });
        ddbMock.on(UpdateCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'PATCH',
                path: '/payments',
                body: JSON.stringify({ uuid: samplePlan.uuid, name: 'Basic (updated)' }),
            }),
        );

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ message: 'Plan updated' });
    });

    it('returns 404 for an unknown plan uuid', async () => {
        ddbMock.on(GetCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'PATCH',
                path: '/payments',
                body: JSON.stringify({ uuid: '99999999-9999-4999-8999-999999999999', name: 'X' }),
            }),
        );

        expect(res.statusCode).toBe(404);
    });
});

describe('DELETE /payments/by-id', () => {
    it('deletes a plan by slug', async () => {
        ddbMock
            .on(GetCommand, { Key: { PK: `PLAN#ID#${samplePlan.plan_id}`, SK: 'META' } })
            .resolves({ Item: { uuid: samplePlan.uuid } });
        ddbMock.on(TransactWriteCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'DELETE',
                path: '/payments/by-id',
                queryStringParameters: { id: samplePlan.plan_id },
            }),
        );

        expect(res.statusCode).toBe(200);
    });

    it('returns 404 for an unknown slug', async () => {
        ddbMock.on(GetCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'DELETE',
                path: '/payments/by-id',
                queryStringParameters: { id: 'nonexistent' },
            }),
        );

        expect(res.statusCode).toBe(404);
    });
});

describe('GET /payments/subscription', () => {
    it("returns the organisation's subscription record", async () => {
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

    it('returns 404 when no subscription exists', async () => {
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
});

describe('POST /payments/subscription', () => {
    const validBody = {
        organisation_id: 'org-1',
        plan_id: 'basic',
        trial_start: '2026-01-01T00:00:00.000Z',
        trial_end: '2026-01-15T00:00:00.000Z',
    };

    it('creates the subscription record and returns 201', async () => {
        ddbMock.on(PutCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'POST', path: '/payments/subscription', body: JSON.stringify(validBody) }),
        );

        expect(res.statusCode).toBe(201);
        const body = JSON.parse(res.body);
        expect(body.organisation_id).toBe('org-1');
        expect(body.status).toBe('trialing');

        // trial-status-index sparse GSI (queried by infra/functions/check-trial-lapses)
        const putCall = ddbMock.commandCalls(PutCommand)[0];
        expect(putCall.args[0].input.Item?.GSI2PK).toBe('SUBSCRIPTION#TRIALING');
        expect(putCall.args[0].input.Item?.GSI2SK).toBe(validBody.trial_end);
    });

    it('returns 409 when a subscription already exists for the organisation', async () => {
        const conflict = new Error('Subscription already exists');
        (conflict as Error & { name: string }).name = 'ConditionalCheckFailedException';
        ddbMock.on(PutCommand).rejects(conflict);

        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'POST', path: '/payments/subscription', body: JSON.stringify(validBody) }),
        );

        expect(res.statusCode).toBe(409);
    });
});

describe('PATCH /payments/subscription', () => {
    it('updates the subscription status (e.g. reactivating after manual payment)', async () => {
        ddbMock
            .on(GetCommand, { Key: { PK: 'ORG#org-1', SK: 'SUBSCRIPTION' } })
            .resolves({ Item: { data: JSON.stringify(sampleSubscription) } });
        ddbMock.on(UpdateCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'PATCH',
                path: '/payments/subscription',
                body: JSON.stringify({
                    organisation_id: 'org-1',
                    status: 'active',
                    payment_method: 'bank_transfer',
                    activated_by: 'staff-user-1',
                    activated_at: '2026-01-16T00:00:00.000Z',
                }),
            }),
        );

        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.status).toBe('active');
        expect(body.payment_method).toBe('bank_transfer');

        // Leaving 'trialing' must drop the item out of the trial-status-index sparse GSI
        const updateCall = ddbMock.commandCalls(UpdateCommand)[0];
        expect(updateCall.args[0].input.UpdateExpression).toContain('REMOVE GSI2PK, GSI2SK');
    });

    it('keeps the trial-status-index GSI attributes when a PATCH leaves status as trialing', async () => {
        ddbMock
            .on(GetCommand, { Key: { PK: 'ORG#org-1', SK: 'SUBSCRIPTION' } })
            .resolves({ Item: { data: JSON.stringify(sampleSubscription) } });
        ddbMock.on(UpdateCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'PATCH',
                path: '/payments/subscription',
                body: JSON.stringify({ organisation_id: 'org-1', trial_end: '2026-01-22T00:00:00.000Z' }),
            }),
        );

        expect(res.statusCode).toBe(200);
        const updateCall = ddbMock.commandCalls(UpdateCommand)[0];
        expect(updateCall.args[0].input.UpdateExpression).toContain('GSI2PK = :gsi2pk, GSI2SK = :gsi2sk');
        expect(updateCall.args[0].input.ExpressionAttributeValues?.[':gsi2sk']).toBe('2026-01-22T00:00:00.000Z');
    });

    it('returns 404 when the organisation has no subscription record', async () => {
        ddbMock.on(GetCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'PATCH',
                path: '/payments/subscription',
                body: JSON.stringify({ organisation_id: 'org-unknown', status: 'active' }),
            }),
        );

        expect(res.statusCode).toBe(404);
    });
});
