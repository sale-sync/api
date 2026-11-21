import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { Organisation } from '@sale-sync/shared/src/types';
import { lambdaHandler } from '../../app';

const ddbMock = mockClient(DynamoDBClient);

const ALLOWED_ORIGIN = 'http://localhost:3003';

function buildEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
    return {
        httpMethod: 'GET',
        path: '/organisations',
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

const sampleOrg: Organisation = {
    uuid: '55555555-5555-4555-8555-555555555555',
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
    it('returns 200 with a paginated list of organisations', async () => {
        ddbMock.on(QueryCommand).resolves({ Items: [{ data: JSON.stringify(sampleOrg) }] });

        const res = await lambdaHandler(buildEvent({ httpMethod: 'GET', path: '/organisations' }));

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ items: [sampleOrg] });
    });

    it('returns 401 when unauthenticated', async () => {
        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'GET', path: '/organisations', headers: { origin: ALLOWED_ORIGIN } }),
        );

        expect(res.statusCode).toBe(401);
    });
});

describe('GET /organisations/by-id', () => {
    it('resolves an organisation by its id slug', async () => {
        // Org slug-lookup items are data-wrapped (matches every writer: client-api's
        // createOrganisation(), admin-api's createOrganisationFromApprovedRequest()) — unlike the Plan
        // slug lookup, which genuinely is a flat `uuid` attribute. These two diverged; this mock
        // previously assumed they matched, which was wrong and made getOrganisationById() throw a real
        // 500 (JSON.parse(undefined)) on every call. See backlogs/onboarding/children/
        // admin-api-organisation-by-id-bug.
        ddbMock
            .on(GetCommand, { Key: { PK: `ORG#ID#${sampleOrg.id}`, SK: 'META' } })
            .resolves({ Item: { data: JSON.stringify({ uuid: sampleOrg.uuid }) } });
        ddbMock
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

    it('updates the organisation status (e.g. staff activating after payment)', async () => {
        ddbMock
            .on(GetCommand, { Key: { PK: 'ORG', SK: `META#${sampleOrg.uuid}` } })
            .resolves({ Item: { data: JSON.stringify(sampleOrg) } });
        ddbMock.on(UpdateCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'PATCH',
                path: '/organisations/by-id',
                body: JSON.stringify({ uuid: sampleOrg.uuid, status: 'active' }),
            }),
        );

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ message: 'Organisation updated' });
        expect(ddbMock).toHaveReceivedCommandTimes(UpdateCommand, 1);
    });

    it('returns 404 when updating an organisation that does not exist', async () => {
        ddbMock.on(GetCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'PATCH',
                path: '/organisations/by-id',
                body: JSON.stringify({ uuid: '99999999-9999-4999-8999-999999999999', status: 'active' }),
            }),
        );

        expect(res.statusCode).toBe(404);
    });
});
