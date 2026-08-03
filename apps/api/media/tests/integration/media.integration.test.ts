import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { lambdaHandler } from '../../app';

// Media is the biggest app here (8 controllers: default, upload, folders, item, properties,
// organisation, user, branding) — this suite deliberately covers just the core "list folder
// contents" flow (GET /media), the entry point every media-browsing session starts from. The
// upload/item/folders/branding/etc. controllers aren't covered yet — same scope boundary as the
// other suites, flagged here since this app's surface is unusually large.
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
    const identifierJwt = fakeJwt({ sub: USER_ID, name: 'Test User', email: 'user@example.com' });
    const organisationJwt = fakeJwt({ organisation_id: 'potato-rocket', user_id: USER_ID, uuid: ORG_UUID });
    return {
        httpMethod: 'GET',
        path: '/media',
        headers: {
            origin: ALLOWED_ORIGIN,
            cookie: `Authentication=fake-token; Identifier=${identifierJwt}; Organisation=${organisationJwt}`,
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

const rootFolder = {
    id: 'root',
    organisation_id: ORG_UUID,
    parent_id: null,
    name: 'Root',
    path: '/',
    level: 0,
    item_count: 0,
    subfolder_count: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    created_by: USER_ID,
};

beforeEach(() => {
    ddbMock.reset();
});

describe('GET /media', () => {
    it('returns 200 with root folder contents, creating the root folder if missing', async () => {
        // First getFolderById('root') call (from ensureRootFolder) finds nothing -> it gets created.
        // Every subsequent getFolderById('root') call resolves it.
        ddbMock
            .on(GetCommand, { Key: { PK: `WS#${ORG_UUID}#FOLDER`, SK: 'FOLDER#root' } })
            .resolvesOnce({})
            .resolves({ Item: { data: rootFolder } });
        ddbMock.on(PutCommand).resolves({});
        ddbMock.on(QueryCommand).resolves({ Items: [] });

        const res = await lambdaHandler(buildEvent({ httpMethod: 'GET', path: '/media' }));

        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.folder).toEqual({
            id: 'root',
            name: 'Root',
            path: '/',
            parent_id: null,
            level: 0,
            created_at: rootFolder.created_at,
            created_by: USER_ID,
        });
        expect(body.folders).toEqual([]);
        expect(body.media).toEqual([]);
        expect(ddbMock).toHaveReceivedCommandWith(PutCommand, {
            Item: expect.objectContaining({ PK: `WS#${ORG_UUID}#FOLDER`, SK: 'FOLDER#root' }),
            ConditionExpression: 'attribute_not_exists(PK)',
        });
    });

    it('returns 401 when unauthenticated', async () => {
        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'GET', path: '/media', headers: { origin: ALLOWED_ORIGIN } }),
        );

        expect(res.statusCode).toBe(401);
    });

    it('returns 404 when the requested folder does not exist', async () => {
        ddbMock
            .on(GetCommand, { Key: { PK: `WS#${ORG_UUID}#FOLDER`, SK: 'FOLDER#root' } })
            .resolves({ Item: { data: rootFolder } });
        ddbMock
            .on(GetCommand, { Key: { PK: `WS#${ORG_UUID}#FOLDER`, SK: 'FOLDER#nonexistent' } })
            .resolves({});

        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'GET', path: '/media', queryStringParameters: { folder_id: 'nonexistent' } }),
        );

        expect(res.statusCode).toBe(404);
    });
});
