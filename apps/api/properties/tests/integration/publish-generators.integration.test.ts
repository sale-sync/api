import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { Property, Unit } from '@sale-sync/shared/src/types';

// The generator function names are read from the environment when the service module loads, so they
// are set first and the app is required afterwards (a top-level import would be hoisted above this).
process.env.PUBLISH_PROPERTY_DETAIL_PAGE_FUNCTION_NAME = 'publish-property-detail-page-fn';
process.env.PUBLISH_PROPERTY_UNIT_DETAIL_PAGE_FUNCTION_NAME = 'publish-property-unit-detail-page-fn';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { lambdaHandler } = require('../../app') as typeof import('../../app');

jest.mock('uuid', () => ({ v4: () => 'mocked-uuid' }));

const ddbMock = mockClient(DynamoDBClient);
const lambdaMock = mockClient(LambdaClient);

const ORG_UUID = 'org-uuid-1';
const PROPERTY_UUID = '33333333-3333-4333-8333-333333333333';
const UNIT_UUID = '44444444-4444-4444-8444-444444444444';
const KEY = { PK: `ORG#${ORG_UUID}#PROPERTY`, SK: `PROPERTY#${PROPERTY_UUID}` };

function fakeJwt(payload: Record<string, unknown>): string {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    return `${header}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;
}

function event(overrides: Partial<APIGatewayProxyEvent>): APIGatewayProxyEvent {
    const org = fakeJwt({ organisation_id: 'potato-rocket', user_id: 'user-1', uuid: ORG_UUID });
    return {
        httpMethod: 'POST',
        path: '/properties/publish',
        headers: { origin: 'http://localhost:3000', cookie: `Authentication=t; Identifier=u; Organisation=${org}` },
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

const unit = { uuid: UNIT_UUID, title: 'Unit 12A', beds: 2, currency: 'AUD', actions: ['sell'], paymentOptions: ['Complete'], videos: [] } as unknown as Unit;
const property = {
    uuid: PROPERTY_UUID,
    title: 'Beachside Villa',
    slug: 'beachside-villa',
    scope: 'public',
    currency: 'AUD',
    units: [unit],
} as unknown as Property;

function store(draft: Property, published?: Property) {
    ddbMock.on(GetCommand, { TableName: 'sale-sync-properties', Key: KEY }).resolves({
        Item: { ...KEY, data: JSON.stringify(draft), ...(published && { published: JSON.stringify(published), published_at: '2026-02-01T00:00:00.000Z' }) },
    });
    ddbMock.on(UpdateCommand).resolves({});
}

const invokedPayloads = (fn: string) =>
    lambdaMock
        .commandCalls(InvokeCommand)
        .filter((call) => call.args[0].input.FunctionName === fn)
        .map((call) => JSON.parse(Buffer.from(call.args[0].input.Payload as string).toString()));

const publish = (body: Record<string, unknown>) => lambdaHandler(event({ body: JSON.stringify(body) }));

beforeEach(() => {
    ddbMock.reset();
    lambdaMock.reset();
    lambdaMock.on(InvokeCommand).resolves({});
});

describe('POST /properties/publish starts page generation', () => {
    it('bakes the property page, and no unit pages when the slug and scope are unchanged', async () => {
        store(property, property);

        const res = await publish({ property_uuid: PROPERTY_UUID });

        expect(res.statusCode).toBe(200);
        expect(invokedPayloads('publish-property-detail-page-fn')).toEqual([
            { organisation_uuid: ORG_UUID, property_uuid: PROPERTY_UUID, slug: 'beachside-villa', removed_slugs: [] },
        ]);
        expect(invokedPayloads('publish-property-unit-detail-page-fn')).toEqual([]);
    });

    it('moves every published unit page when the slug changes', async () => {
        store({ ...property, slug: 'new-slug' }, property);

        await publish({ property_uuid: PROPERTY_UUID });

        expect(invokedPayloads('publish-property-detail-page-fn')[0]).toMatchObject({ slug: 'new-slug', removed_slugs: ['beachside-villa'] });
        expect(invokedPayloads('publish-property-unit-detail-page-fn')).toEqual([
            {
                organisation_uuid: ORG_UUID,
                property_uuid: PROPERTY_UUID,
                property_slug: 'new-slug',
                unit_uuids: [UNIT_UUID],
                removed: [{ property_slug: 'beachside-villa', unit_uuid: UNIT_UUID }],
            },
        ]);
    });

    it('re-bakes the unit pages when the property stops being public, so the generator can remove them', async () => {
        store({ ...property, scope: 'staff' }, property);

        await publish({ property_uuid: PROPERTY_UUID });

        expect(invokedPayloads('publish-property-unit-detail-page-fn')[0]).toMatchObject({ unit_uuids: [UNIT_UUID], removed: [] });
    });

    it('bakes only the one unit when a unit is published', async () => {
        store(property, { ...property, units: [] });

        const res = await publish({ property_uuid: PROPERTY_UUID, unit_uuid: UNIT_UUID });

        expect(res.statusCode).toBe(200);
        expect(invokedPayloads('publish-property-unit-detail-page-fn')).toEqual([
            { organisation_uuid: ORG_UUID, property_uuid: PROPERTY_UUID, property_slug: 'beachside-villa', unit_uuids: [UNIT_UUID], removed: [] },
        ]);
        expect(invokedPayloads('publish-property-detail-page-fn')).toEqual([]);
    });

    it('still succeeds when the generator invoke fails', async () => {
        store(property, property);
        lambdaMock.on(InvokeCommand).rejects(new Error('boom'));
        jest.spyOn(console, 'error').mockImplementation(() => undefined);

        const res = await publish({ property_uuid: PROPERTY_UUID });

        expect(res.statusCode).toBe(200);
    });
});

describe('deleting removes what was baked', () => {
    it('removes a published unit page when the unit is deleted', async () => {
        store(property, property);

        const res = await lambdaHandler(
            event({ httpMethod: 'DELETE', path: '/properties/units', body: JSON.stringify({ property_uuid: PROPERTY_UUID, unit_uuid: UNIT_UUID }) }),
        );

        expect(res.statusCode).toBe(200);
        expect(invokedPayloads('publish-property-unit-detail-page-fn')).toEqual([
            { organisation_uuid: ORG_UUID, property_uuid: PROPERTY_UUID, removed: [{ property_slug: 'beachside-villa', unit_uuid: UNIT_UUID }] },
        ]);
    });

    it('does not invoke a generator when an unpublished unit is deleted', async () => {
        store(property, { ...property, units: [] });

        await lambdaHandler(
            event({ httpMethod: 'DELETE', path: '/properties/units', body: JSON.stringify({ property_uuid: PROPERTY_UUID, unit_uuid: UNIT_UUID }) }),
        );

        expect(lambdaMock).not.toHaveReceivedCommand(InvokeCommand);
    });

    it('removes the property page and every unit page when a published property is deleted', async () => {
        store(property, property);
        ddbMock.on(TransactWriteCommand).resolves({});

        const res = await lambdaHandler(
            event({ httpMethod: 'DELETE', path: '/properties', body: JSON.stringify({ property_uuid: PROPERTY_UUID }) }),
        );

        expect(res.statusCode).toBe(200);
        expect(invokedPayloads('publish-property-detail-page-fn')).toEqual([
            { organisation_uuid: ORG_UUID, property_uuid: PROPERTY_UUID, removed_slugs: ['beachside-villa'] },
        ]);
        expect(invokedPayloads('publish-property-unit-detail-page-fn')[0].removed).toEqual([{ property_slug: 'beachside-villa', unit_uuid: UNIT_UUID }]);
    });

    it('invokes nothing when a never-published property is deleted', async () => {
        store(property);
        ddbMock.on(TransactWriteCommand).resolves({});

        await lambdaHandler(event({ httpMethod: 'DELETE', path: '/properties', body: JSON.stringify({ property_uuid: PROPERTY_UUID }) }));

        expect(lambdaMock).not.toHaveReceivedCommand(InvokeCommand);
    });
});
