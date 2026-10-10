import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { ConditionalCheckFailedException, DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { Organisation, OrganisationUser, Property, Unit } from '@sale-sync/shared/src/types';
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
    swimmingPool: false,
    completion: null,
    completionDate: null,
    totalFloor: null,
    petFriendly: 'No Pets',
    commonAreaFees: null,
    sinkingFund: null,
    videos: [],
    brochure: null,
    image: null,
    images: [],
    description: null,
    payment: null,
    units: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
};

// What the dashboard sees for a stored property that has never been published.
const unpublished = (property: Property): Property => ({ ...property, publishStatus: 'unpublished', published_at: null });

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
        expect(JSON.parse(res.body)).toEqual([unpublished(publicProperty)]);
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
        expect(JSON.parse(res.body)).toEqual(unpublished(publicProperty));
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
        expect(JSON.parse(res.body)).toEqual([unpublished(publicProperty)]);
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

const UNIT_UUID = '44444444-4444-4444-8444-444444444444';
const PROPERTY_KEY = { PK: `ORG#${ORG_UUID}#PROPERTY`, SK: `PROPERTY#${publicProperty.uuid}` };

const unit: Unit = {
    uuid: UNIT_UUID,
    title: 'Unit 12A',
    image: null,
    actions: ['sell'],
    sellPrice: 500000,
    sellDiscountPrice: null,
    sellMaxPrice: null,
    soldPrice: null,
    rentPrice: null,
    beds: 2,
    baths: 1,
    hall: null,
    kitchen: null,
    pantry: null,
    car: null,
    unitSize: null,
    landSize: null,
    condition: null,
    furnishing: null,
    ownership: null,
    petFriendly: null,
    multipurposeRoom: null,
    poolVilla: false,
    livingRoom: null,
    commonAreaFees: null,
    sinkingFund: null,
    commonAreaFeesOverridden: false,
    sinkingFundOverridden: false,
    videos: [],
    bookingFees: null,
    contractFees: null,
    contractFeesTimeline: null,
    paymentOptions: ['Complete'],
    finalPayment: null,
    finalPaymentTimeline: null,
    installmentPayment: null,
    installmentPaymentTimeline: null,
    currency: 'AUD',
};

const withUnit: Property = { ...publicProperty, units: [unit] };

function mockStoredProperty(draft: Property, published?: Property, publishedAt = '2026-02-01T00:00:00.000Z') {
    ddbMock.on(GetCommand, { TableName: 'sale-sync-properties', Key: PROPERTY_KEY }).resolves({
        Item: {
            ...PROPERTY_KEY,
            data: JSON.stringify(draft),
            ...(published && { published: JSON.stringify(published), published_at: publishedAt }),
        },
    });
}

describe('publish state on reads', () => {
    it('marks a never-published property and its units unpublished', async () => {
        mockStoredProperty(withUnit);

        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'GET', path: '/properties', queryStringParameters: { propertyUuid: publicProperty.uuid } }),
        );

        const body = JSON.parse(res.body);
        expect(body.publishStatus).toBe('unpublished');
        expect(body.units[0].publishStatus).toBe('unpublished');
    });

    it('marks a unit changed once its draft differs from the published copy, and the property published', async () => {
        mockStoredProperty({ ...withUnit, units: [{ ...unit, beds: 3 }] }, withUnit);

        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'GET', path: '/properties', queryStringParameters: { propertyUuid: publicProperty.uuid } }),
        );

        const body = JSON.parse(res.body);
        expect(body.publishStatus).toBe('published');
        expect(body.units[0].publishStatus).toBe('changed');
    });
});

describe('POST /properties/units', () => {
    it('adds a unit to the draft only, behind an optimistic lock', async () => {
        mockStoredProperty(publicProperty);
        ddbMock.on(UpdateCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'POST',
                path: '/properties/units',
                body: JSON.stringify({ property_uuid: publicProperty.uuid, title: 'Unit 12A', beds: 2 }),
            }),
        );

        expect(res.statusCode).toBe(201);
        expect(JSON.parse(res.body)).toMatchObject({ title: 'Unit 12A', beds: 2, currency: 'AUD', publishStatus: 'unpublished' });
        expect(ddbMock).toHaveReceivedCommandWith(UpdateCommand, {
            Key: PROPERTY_KEY,
            UpdateExpression: 'SET #data = :data',
            ConditionExpression: '#data = :prevData',
        });
        const saved = JSON.parse(ddbMock.commandCalls(UpdateCommand)[0].args[0].input.ExpressionAttributeValues![':data']);
        expect(saved.units).toHaveLength(1);
    });

    it('returns 404 when the property does not exist', async () => {
        ddbMock.on(GetCommand, { TableName: 'sale-sync-properties' }).resolves({});

        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'POST', path: '/properties/units', body: JSON.stringify({ property_uuid: publicProperty.uuid, title: 'x' }) }),
        );

        expect(res.statusCode).toBe(404);
    });

    it('returns 400 for an invalid body', async () => {
        const res = await lambdaHandler(buildEvent({ httpMethod: 'POST', path: '/properties/units', body: JSON.stringify({ title: 'x' }) }));

        expect(res.statusCode).toBe(400);
        expect(ddbMock).not.toHaveReceivedCommand(UpdateCommand);
    });

    it('returns 409 when the draft changed under the save', async () => {
        mockStoredProperty(publicProperty);
        ddbMock.on(UpdateCommand).rejects(new ConditionalCheckFailedException({ message: 'conflict', $metadata: {} }));

        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'POST', path: '/properties/units', body: JSON.stringify({ property_uuid: publicProperty.uuid, title: 'x' }) }),
        );

        expect(res.statusCode).toBe(409);
    });

    it('requires authentication', async () => {
        const res = await lambdaHandler(buildEvent({ httpMethod: 'POST', path: '/properties/units', headers: { origin: ALLOWED_ORIGIN } }));

        expect(res.statusCode).toBe(401);
    });
});

describe('PATCH /properties/units', () => {
    it('merges the update into the unit and reports it changed against the published copy', async () => {
        mockStoredProperty(withUnit, withUnit);
        ddbMock.on(UpdateCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'PATCH',
                path: '/properties/units',
                body: JSON.stringify({ property_uuid: publicProperty.uuid, unit_uuid: UNIT_UUID, beds: 4 }),
            }),
        );

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toMatchObject({ uuid: UNIT_UUID, title: 'Unit 12A', beds: 4, publishStatus: 'changed' });
    });

    it('returns 404 for an unknown unit', async () => {
        mockStoredProperty(withUnit);

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'PATCH',
                path: '/properties/units',
                body: JSON.stringify({ property_uuid: publicProperty.uuid, unit_uuid: '55555555-5555-4555-8555-555555555555', beds: 1 }),
            }),
        );

        expect(res.statusCode).toBe(404);
    });
});

describe('DELETE /properties/units', () => {
    it('removes the unit from the draft and from the published copy in the same write', async () => {
        mockStoredProperty(withUnit, withUnit);
        ddbMock.on(UpdateCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'DELETE',
                path: '/properties/units',
                body: JSON.stringify({ property_uuid: publicProperty.uuid, unit_uuid: UNIT_UUID }),
            }),
        );

        expect(res.statusCode).toBe(200);
        const values = ddbMock.commandCalls(UpdateCommand)[0].args[0].input.ExpressionAttributeValues!;
        expect(JSON.parse(values[':data']).units).toEqual([]);
        expect(JSON.parse(values[':published']).units).toEqual([]);
    });
});

describe('POST /properties/publish', () => {
    it('publishes the property fields while keeping already-published units', async () => {
        mockStoredProperty({ ...withUnit, title: 'Renamed Villa' }, withUnit);
        ddbMock.on(UpdateCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'POST', path: '/properties/publish', body: JSON.stringify({ property_uuid: publicProperty.uuid }) }),
        );

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).publishStatus).toBe('published');
        const values = ddbMock.commandCalls(UpdateCommand)[0].args[0].input.ExpressionAttributeValues!;
        const published = JSON.parse(values[':published']);
        expect(published.title).toBe('Renamed Villa');
        expect(published.units).toHaveLength(1);
        expect(values[':prevData']).toBeDefined();
    });

    it('publishes a first-time property with no units', async () => {
        mockStoredProperty(withUnit);
        ddbMock.on(UpdateCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'POST', path: '/properties/publish', body: JSON.stringify({ property_uuid: publicProperty.uuid }) }),
        );

        expect(res.statusCode).toBe(200);
        const published = JSON.parse(ddbMock.commandCalls(UpdateCommand)[0].args[0].input.ExpressionAttributeValues![':published']);
        expect(published.units).toEqual([]);
    });

    it('publishes one unit into the published copy', async () => {
        mockStoredProperty({ ...withUnit, units: [{ ...unit, beds: 5 }] }, { ...publicProperty, units: [] });
        ddbMock.on(UpdateCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'POST',
                path: '/properties/publish',
                body: JSON.stringify({ property_uuid: publicProperty.uuid, unit_uuid: UNIT_UUID }),
            }),
        );

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toMatchObject({ uuid: UNIT_UUID, beds: 5, publishStatus: 'published' });
        const published = JSON.parse(ddbMock.commandCalls(UpdateCommand)[0].args[0].input.ExpressionAttributeValues![':published']);
        expect(published.units).toHaveLength(1);
        expect(published.units[0].beds).toBe(5);
    });

    it('refuses to publish a unit before its property is published', async () => {
        mockStoredProperty(withUnit);

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'POST',
                path: '/properties/publish',
                body: JSON.stringify({ property_uuid: publicProperty.uuid, unit_uuid: UNIT_UUID }),
            }),
        );

        expect(res.statusCode).toBe(409);
        expect(ddbMock).not.toHaveReceivedCommand(UpdateCommand);
    });
});
