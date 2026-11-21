import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { lambdaHandler } from '../../app';

// Media is the biggest app here (9 controllers: default, upload, folders, item, properties,
// organisation, user, branding, agents) — this suite deliberately covers just the core "list
// folder contents" flow (GET /media), the entry point every media-browsing session starts from,
// plus the new agents presigned-upload controller. The upload/item/folders/branding/properties/
// organisation/user controllers aren't covered yet — same scope boundary as the other suites,
// flagged here since this app's surface is unusually large.
const ddbMock = mockClient(DynamoDBClient);
const s3Mock = mockClient(S3Client);

// S3Service.generateUploadUrl calls the presigner's getSignedUrl() function directly (not a
// mockable S3Client command) — stub it so agents-upload tests don't need real AWS credentials.
jest.mock('@aws-sdk/s3-request-presigner', () => ({
    getSignedUrl: jest.fn().mockResolvedValue('https://presigned.example.com/upload'),
}));

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
    s3Mock.reset();
    process.env.MEDIA_CDN_DOMAIN = 'cdn.salesync.biz';
    process.env.MEDIA_BUCKET_NAME = 'sale-sync-media';
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

describe('POST /media/agents', () => {
    const validBody = { file_name: 'headshot.jpg', mime_type: 'image/jpeg' };

    it('returns 201 with a presigned upload URL + durable CDN URL', async () => {
        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'POST', path: '/media/agents', body: JSON.stringify(validBody) }),
        );

        expect(res.statusCode).toBe(201);
        const body = JSON.parse(res.body);
        expect(body.upload_url).toBe('https://presigned.example.com/upload');
        expect(body.image_url).toBe(`https://cdn.salesync.biz/cdn/${ORG_UUID}/agents/${body.s3_key.split('/').pop()}`);
        expect(body.s3_key).toMatch(new RegExp(`^cdn/${ORG_UUID}/agents/.+-headshot\\.jpg$`));
        expect(body.expires_at).toBeDefined();
    });

    it('returns 400 for an unsupported mime type', async () => {
        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'POST',
                path: '/media/agents',
                body: JSON.stringify({ file_name: 'resume.pdf', mime_type: 'application/pdf' }),
            }),
        );

        expect(res.statusCode).toBe(400);
    });

    it('returns 401 when unauthenticated', async () => {
        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'POST',
                path: '/media/agents',
                headers: { origin: ALLOWED_ORIGIN },
                body: JSON.stringify(validBody),
            }),
        );

        expect(res.statusCode).toBe(401);
    });
});

describe('DELETE /media/agents', () => {
    it("returns 200 and deletes the object when the s3_key belongs to the caller's organisation", async () => {
        s3Mock.on(DeleteObjectCommand).resolves({});
        const s3Key = `cdn/${ORG_UUID}/agents/some-uuid-headshot.jpg`;

        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'DELETE', path: '/media/agents', body: JSON.stringify({ s3_key: s3Key }) }),
        );

        expect(res.statusCode).toBe(200);
        expect(s3Mock).toHaveReceivedCommandWith(DeleteObjectCommand, { Bucket: 'sale-sync-media', Key: s3Key });
    });

    it("returns 403 when the s3_key does not belong to the caller's organisation", async () => {
        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'DELETE',
                path: '/media/agents',
                body: JSON.stringify({ s3_key: 'cdn/some-other-org/agents/some-uuid-headshot.jpg' }),
            }),
        );

        expect(res.statusCode).toBe(403);
        expect(s3Mock).not.toHaveReceivedCommand(DeleteObjectCommand);
    });

    it('returns 400 when s3_key is missing', async () => {
        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'DELETE', path: '/media/agents', body: JSON.stringify({}) }),
        );

        expect(res.statusCode).toBe(400);
    });

    it('returns 401 when unauthenticated', async () => {
        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'DELETE',
                path: '/media/agents',
                headers: { origin: ALLOWED_ORIGIN },
                body: JSON.stringify({ s3_key: `cdn/${ORG_UUID}/agents/some-uuid-headshot.jpg` }),
            }),
        );

        expect(res.statusCode).toBe(401);
    });
});
