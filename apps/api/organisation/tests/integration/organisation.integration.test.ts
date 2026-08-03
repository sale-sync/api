import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { BatchGetCommand, GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { Organisation } from '@sale-sync/shared/src/types';
import { lambdaHandler } from '../../app';

// `uuid@13` ships ESM-only (no CJS build), which Jest's default CommonJS `require()` can't load —
// production bundling works fine (esbuild statically bundles it), but Jest needs a stub. We don't
// assert on the generated uuid's exact value anywhere, so a fixed mock is sufficient.
jest.mock('uuid', () => ({ v4: () => 'mocked-org-uuid' }));

// Covers the two highest-traffic controllers (default: list/create, by-id: lookup) — the
// team/profile/branding/templates/theme controllers aren't covered yet (same scope boundary as
// the payments/auth suites: core flows first, not every sub-resource in one pass).
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

describe('POST /organisations', () => {
    const validBody = {
        organisation_id: 'potato-rocket',
        organisation_name: 'Potato Rocket',
        business_category: 'service-business',
        template_id: '11111111-1111-4111-8111-111111111111',
        plan_id: '22222222-2222-4222-8222-222222222222',
    };

    it('creates an organisation and returns 201', async () => {
        ddbMock.on(TransactWriteCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'POST', path: '/organisations', body: JSON.stringify(validBody) }),
        );

        expect(res.statusCode).toBe(201);
        expect(JSON.parse(res.body)).toEqual({
            message: 'Organisation created',
            organisation_id: 'potato-rocket',
            organisation_name: 'Potato Rocket',
        });
        expect(ddbMock).toHaveReceivedCommandTimes(TransactWriteCommand, 1);
    });

    it('starts a 14-day trial subscription record alongside the organisation', async () => {
        ddbMock.on(TransactWriteCommand).resolves({});

        await lambdaHandler(
            buildEvent({ httpMethod: 'POST', path: '/organisations', body: JSON.stringify(validBody) }),
        );

        const call = ddbMock.commandCalls(TransactWriteCommand)[0];
        const subscriptionItem = call.args[0].input.TransactItems?.find(
            (item) => item.Put?.Item?.SK === 'SUBSCRIPTION',
        );
        expect(subscriptionItem).toBeDefined();
        expect(subscriptionItem?.Put?.Item?.PK).toBe('ORG#mocked-org-uuid');

        const subscription = JSON.parse(subscriptionItem?.Put?.Item?.data as string);
        expect(subscription.organisation_id).toBe('mocked-org-uuid');
        expect(subscription.plan_id).toBe(validBody.plan_id);
        expect(subscription.status).toBe('trialing');
        expect(subscription.payment_method).toBeNull();

        const trialStart = new Date(subscription.trial_start).getTime();
        const trialEnd = new Date(subscription.trial_end).getTime();
        expect(trialEnd - trialStart).toBe(14 * 24 * 60 * 60 * 1000);

        // trial-status-index sparse GSI (queried by infra/functions/check-trial-lapses)
        expect(subscriptionItem?.Put?.Item?.GSI2PK).toBe('SUBSCRIPTION#TRIALING');
        expect(subscriptionItem?.Put?.Item?.GSI2SK).toBe(subscription.trial_end);
    });

    it('returns 400 when required fields are missing', async () => {
        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'POST', path: '/organisations', body: JSON.stringify({}) }),
        );

        expect(res.statusCode).toBe(400);
        expect(ddbMock).not.toHaveReceivedCommand(TransactWriteCommand);
    });

    it('returns 409 when the organisation_id already exists', async () => {
        ddbMock.on(TransactWriteCommand).rejects(
            new TransactionCanceledException({
                message: 'Transaction cancelled',
                $metadata: {},
                CancellationReasons: [{ Code: 'ConditionalCheckFailed' }],
            }),
        );

        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'POST', path: '/organisations', body: JSON.stringify(validBody) }),
        );

        expect(res.statusCode).toBe(409);
    });
});

describe('POST /organisations — promo code redemption (backlogs/payments/children/promo-codes)', () => {
    const validBody = {
        organisation_id: 'potato-rocket',
        organisation_name: 'Potato Rocket',
        business_category: 'service-business',
        template_id: '11111111-1111-4111-8111-111111111111',
        plan_id: '22222222-2222-4222-8222-222222222222',
    };

    const PROMO_UUID = 'promo-uuid-1';

    function mockPromoLookup(code: string, promoItem: Record<string, unknown> | undefined) {
        const lookupChain = ddbMock.on(GetCommand, { Key: { PK: `PROMO#CODE#${code}`, SK: 'META' } });
        if (!promoItem) {
            lookupChain.resolves({});
            return;
        }
        lookupChain.resolves({ Item: { uuid: PROMO_UUID } });
        ddbMock
            .on(GetCommand, { Key: { PK: 'PROMO', SK: `META#${PROMO_UUID}` } })
            .resolves({ Item: promoItem });
    }

    it('redeems a valid percentage code, discounts the subscription, and consumes the code atomically', async () => {
        mockPromoLookup('LAUNCH50', {
            uuid: PROMO_UUID,
            code: 'LAUNCH50',
            type: 'percentage',
            value: 20,
            redemption_count: 0,
            status: 'active',
            created_by: 'staff-1',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
        });
        ddbMock.on(TransactWriteCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'POST',
                path: '/organisations',
                // lowercase on input — redemption lookup is case-insensitive
                body: JSON.stringify({ ...validBody, promo_code: 'launch50' }),
            }),
        );

        expect(res.statusCode).toBe(201);

        const call = ddbMock.commandCalls(TransactWriteCommand)[0];
        const items = call.args[0].input.TransactItems ?? [];
        expect(items).toHaveLength(8);

        const subscriptionItem = items.find((item) => item.Put?.Item?.SK === 'SUBSCRIPTION');
        const subscription = JSON.parse(subscriptionItem?.Put?.Item?.data as string);
        expect(subscription.promo_code).toBe('LAUNCH50');
        expect(subscription.discount_type).toBe('percentage');
        expect(subscription.discount_value).toBe(20);

        const promoUpdateItem = items[6];
        expect(promoUpdateItem.Update?.Key).toEqual({ PK: 'PROMO', SK: `META#${PROMO_UUID}` });
        expect(promoUpdateItem.Update?.UpdateExpression).toContain('ADD redemption_count');

        const redemptionLockItem = items[7];
        expect(redemptionLockItem.Put?.Item?.PK).toBe(`PROMO#${PROMO_UUID}`);
        expect(redemptionLockItem.Put?.Item?.SK).toBe('REDEMPTION#mocked-org-uuid');
    });

    it('extends the trial by the code\'s value in days for a trial_extension_days code', async () => {
        mockPromoLookup('EXTEND7', {
            uuid: PROMO_UUID,
            code: 'EXTEND7',
            type: 'trial_extension_days',
            value: 7,
            redemption_count: 0,
            status: 'active',
            created_by: 'staff-1',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
        });
        ddbMock.on(TransactWriteCommand).resolves({});

        await lambdaHandler(
            buildEvent({
                httpMethod: 'POST',
                path: '/organisations',
                body: JSON.stringify({ ...validBody, promo_code: 'EXTEND7' }),
            }),
        );

        const call = ddbMock.commandCalls(TransactWriteCommand)[0];
        const items = call.args[0].input.TransactItems ?? [];
        const subscriptionItem = items.find((item) => item.Put?.Item?.SK === 'SUBSCRIPTION');
        const subscription = JSON.parse(subscriptionItem?.Put?.Item?.data as string);

        expect(subscription.discount_type).toBeNull();
        expect(subscription.promo_code).toBe('EXTEND7');

        const trialStart = new Date(subscription.trial_start).getTime();
        const trialEnd = new Date(subscription.trial_end).getTime();
        expect(trialEnd - trialStart).toBe(21 * 24 * 60 * 60 * 1000); // 14-day base trial + 7
    });

    it('returns 400 for an unknown promo code and never attempts org creation', async () => {
        mockPromoLookup('BOGUS', undefined);

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'POST',
                path: '/organisations',
                body: JSON.stringify({ ...validBody, promo_code: 'BOGUS' }),
            }),
        );

        expect(res.statusCode).toBe(400);
        expect(ddbMock).not.toHaveReceivedCommand(TransactWriteCommand);
    });

    it('returns 400 for an expired promo code', async () => {
        mockPromoLookup('OLDCODE', {
            uuid: PROMO_UUID,
            code: 'OLDCODE',
            type: 'percentage',
            value: 10,
            redemption_count: 0,
            status: 'active',
            expires_at: '2020-01-01T00:00:00.000Z',
            created_by: 'staff-1',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
        });

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'POST',
                path: '/organisations',
                body: JSON.stringify({ ...validBody, promo_code: 'OLDCODE' }),
            }),
        );

        expect(res.statusCode).toBe(400);
        expect(ddbMock).not.toHaveReceivedCommand(TransactWriteCommand);
    });

    it('returns 400 for a promo code that has reached its redemption limit', async () => {
        mockPromoLookup('MAXEDOUT', {
            uuid: PROMO_UUID,
            code: 'MAXEDOUT',
            type: 'flat_amount',
            value: 50,
            max_redemptions: 1,
            redemption_count: 1,
            status: 'active',
            created_by: 'staff-1',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
        });

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'POST',
                path: '/organisations',
                body: JSON.stringify({ ...validBody, promo_code: 'MAXEDOUT' }),
            }),
        );

        expect(res.statusCode).toBe(400);
        expect(ddbMock).not.toHaveReceivedCommand(TransactWriteCommand);
    });

    it('returns 400 (not 409) when the promo condition loses a redemption race at write time', async () => {
        mockPromoLookup('RACEY', {
            uuid: PROMO_UUID,
            code: 'RACEY',
            type: 'percentage',
            value: 10,
            max_redemptions: 1,
            redemption_count: 0,
            status: 'active',
            created_by: 'staff-1',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
        });
        // 8 items total; the promo redemption-count update (index 6) lost the race.
        const reasons = Array.from({ length: 8 }, (_, i) => (i === 6 ? { Code: 'ConditionalCheckFailed' } : { Code: 'None' }));
        ddbMock.on(TransactWriteCommand).rejects(
            new TransactionCanceledException({ message: 'Transaction cancelled', $metadata: {}, CancellationReasons: reasons }),
        );

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'POST',
                path: '/organisations',
                body: JSON.stringify({ ...validBody, promo_code: 'RACEY' }),
            }),
        );

        expect(res.statusCode).toBe(400);
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
