import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { Organisation, OrganisationUser, Property } from '@sale-sync/shared/src/types';
import { lambdaHandler } from '../../app';

// `uuid@13` ships ESM-only (no CJS build) — Jest's default CommonJS require() can't load it.
jest.mock('uuid', () => ({ v4: () => 'mocked-property-uuid' }));

// Covers the core CRUD + real-estate gating + viewer-scope filtering — not every GSI list
// endpoint individually (listByCity/Suburb/Postcode/Region/Type are all structurally identical
// query patterns to listByCountry, which is covered as the representative example).
const ddbMock = mockClient(DynamoDBClient);

const ALLOWED_ORIGIN = 'http://localhost:3000';
const ORG_UUID = 'org-uuid-1';
const USER_ID = 'user-1';

function fakeJwt(payload: Record<string, unknown>): string {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${header}.${body}.fake-signature`;
}

function buildEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
    const organisationJwt = fakeJwt({ organisation_id: 'potato-rocket', user_id: USER_ID, uuid: ORG_UUID });
    return {
        httpMethod: 'GET',
        path: '/properties',
        headers: {
            origin: ALLOWED_ORIGIN,
            cookie: `Authentication=fake-token; Identifier=fake-uid; Organisation=${organisationJwt}`,
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

const realEstateOrg: Organisation = {
    uuid: ORG_UUID,
    id: 'potato-rocket',
    name: 'Potato Rocket',
    status: 'ready',
    image: null,
    business_category: 'real-estate',
    template_id: '11111111-1111-4111-8111-111111111111',
    plan_id: '22222222-2222-4222-8222-222222222222',
    created_at: '2026-01-01T00:00:00.000Z',
    address: null,
    market: 'AU',
};

const staffMembership: OrganisationUser = { role: 'staff', joined_date: '2026-01-01T00:00:00.000Z' };

const publicProperty: Property = {
    uuid: '33333333-3333-4333-8333-333333333333',
    title: 'Beachside Villa',
    lat: -33.8688,
    lng: 151.2093,
    location: '123 Beach Rd',
    country: 'AU',
    currency: 'AUD',
    region: 'NSW',
    city: null,
    neighborhood: null,
    suburb: 'Bondi',
    postcode: '2026',
    type: 'house',
    subType: null,
    scope: 'public',
    slug: 'beachside-villa',
    sellPrice: 1500000,
    sellDiscountPrice: null,
    sellMaxPrice: null,
    code: null,
    isLeasehold: false,
    brochure: null,
    image: null,
    images: [],
    description: null,
    payment: null,
    units: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
};

function mockOrgMetadata() {
    ddbMock
        .on(GetCommand, { TableName: 'sale-sync-organisation', Key: { PK: 'ORG', SK: `META#${ORG_UUID}` } })
        .resolves({ Item: { data: JSON.stringify(realEstateOrg) } });
}

function mockViewerMembership() {
    ddbMock
        .on(GetCommand, { TableName: 'sale-sync-organisation', Key: { PK: `ORG#${ORG_UUID}`, SK: `USER#${USER_ID}` } })
        .resolves({ Item: { data: JSON.stringify(staffMembership) } });
}

beforeEach(() => {
    ddbMock.reset();
    mockViewerMembership();
});

describe('GET /properties', () => {
    it('lists all visible properties for the organisation', async () => {
        ddbMock
            .on(QueryCommand, { TableName: 'sale-sync-properties' })
            .resolves({ Items: [{ data: JSON.stringify(publicProperty) }] });

        const res = await lambdaHandler(buildEvent({ httpMethod: 'GET', path: '/properties' }));

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual([publicProperty]);
    });

    it('filters out staff-only-scope properties for a guest viewer', async () => {
        ddbMock
            .on(GetCommand, { TableName: 'sale-sync-organisation', Key: { PK: `ORG#${ORG_UUID}`, SK: `USER#${USER_ID}` } })
            .resolves({ Item: { data: JSON.stringify({ role: 'guest', joined_date: '2026-01-01' }) } });
        ddbMock.on(QueryCommand, { TableName: 'sale-sync-properties' }).resolves({
            Items: [{ data: JSON.stringify({ ...publicProperty, scope: 'staff', uuid: 'staff-only' }) }],
        });

        const res = await lambdaHandler(buildEvent({ httpMethod: 'GET', path: '/properties' }));

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual([]);
    });

    it('gets a single property by propertyUuid', async () => {
        ddbMock
            .on(GetCommand, { TableName: 'sale-sync-properties', Key: { PK: `ORG#${ORG_UUID}#PROPERTY`, SK: `PROPERTY#${publicProperty.uuid}` } })
            .resolves({ Item: { data: JSON.stringify(publicProperty) } });

        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'GET', path: '/properties', queryStringParameters: { propertyUuid: publicProperty.uuid } }),
        );

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual(publicProperty);
    });

    it('returns 404 for an unknown propertyUuid', async () => {
        ddbMock.on(GetCommand, { TableName: 'sale-sync-properties' }).resolves({});

        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'GET', path: '/properties', queryStringParameters: { propertyUuid: 'nonexistent' } }),
        );

        expect(res.statusCode).toBe(404);
    });

    it('lists properties by country via the area GSI', async () => {
        ddbMock.on(QueryCommand, { IndexName: 'property-area-index' }).resolves({
            Items: [{ data: JSON.stringify(publicProperty) }],
        });

        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'GET', path: '/properties', queryStringParameters: { country: 'AU' } }),
        );

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual([publicProperty]);
        expect(ddbMock).toHaveReceivedCommandWith(QueryCommand, {
            IndexName: 'property-area-index',
            ExpressionAttributeValues: { ':pk': `ORG#${ORG_UUID}#PROPERTY#COUNTRY#AU` },
        });
    });

    it('returns 401 when unauthenticated', async () => {
        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'GET', path: '/properties', headers: { origin: ALLOWED_ORIGIN } }),
        );

        expect(res.statusCode).toBe(401);
    });
});

describe('POST /properties', () => {
    const validBody = {
        title: 'Beachside Villa',
        lat: -33.8688,
        lng: 151.2093,
        location: '123 Beach Rd',
        type: 'house',
        slug: 'beachside-villa',
    };

    it('creates a property and returns 201', async () => {
        mockOrgMetadata();
        ddbMock.on(TransactWriteCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'POST', path: '/properties', body: JSON.stringify(validBody) }),
        );

        expect(res.statusCode).toBe(201);
        const body = JSON.parse(res.body);
        expect(body.uuid).toBe('mocked-property-uuid');
        expect(body.title).toBe('Beachside Villa');
        expect(body.country).toBe('AU');
        expect(body.currency).toBe('AUD');
    });

    it('returns 404 when the organisation does not exist', async () => {
        ddbMock.on(GetCommand, { TableName: 'sale-sync-organisation', Key: { PK: 'ORG', SK: `META#${ORG_UUID}` } }).resolves({});

        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'POST', path: '/properties', body: JSON.stringify(validBody) }),
        );

        expect(res.statusCode).toBe(404);
    });

    it('returns 403 when the organisation is not a real-estate business', async () => {
        ddbMock
            .on(GetCommand, { TableName: 'sale-sync-organisation', Key: { PK: 'ORG', SK: `META#${ORG_UUID}` } })
            .resolves({ Item: { data: JSON.stringify({ ...realEstateOrg, business_category: 'fitness' }) } });

        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'POST', path: '/properties', body: JSON.stringify(validBody) }),
        );

        expect(res.statusCode).toBe(403);
    });

    it('returns 409 when the slug already exists for this organisation', async () => {
        mockOrgMetadata();
        ddbMock.on(TransactWriteCommand).rejects(
            new TransactionCanceledException({
                message: 'Transaction cancelled',
                $metadata: {},
                CancellationReasons: [{ Code: 'None' }, { Code: 'ConditionalCheckFailed' }],
            }),
        );

        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'POST', path: '/properties', body: JSON.stringify(validBody) }),
        );

        expect(res.statusCode).toBe(409);
    });

    it('returns 400 when required fields are missing', async () => {
        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'POST', path: '/properties', body: JSON.stringify({}) }),
        );

        expect(res.statusCode).toBe(400);
        expect(ddbMock).not.toHaveReceivedCommand(TransactWriteCommand);
    });
});

describe('DELETE /properties', () => {
    it('deletes an existing property', async () => {
        ddbMock
            .on(GetCommand, { TableName: 'sale-sync-properties', Key: { PK: `ORG#${ORG_UUID}#PROPERTY`, SK: `PROPERTY#${publicProperty.uuid}` } })
            .resolves({ Item: { data: JSON.stringify(publicProperty) } });
        ddbMock.on(TransactWriteCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'DELETE',
                path: '/properties',
                body: JSON.stringify({ property_uuid: publicProperty.uuid }),
            }),
        );

        expect(res.statusCode).toBe(200);
        expect(ddbMock).toHaveReceivedCommandTimes(TransactWriteCommand, 1);
    });
});
