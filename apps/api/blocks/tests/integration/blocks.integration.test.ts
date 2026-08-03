import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { Block, MetaObject } from '../../types/blocks.types';
import { lambdaHandler } from '../../app';

// Unlike the other integration suites, BlocksService wraps the injected raw client in its own
// `DynamoDBDocumentClient.from(...)` instance rather than calling `.send()` on the raw client
// directly — `DynamoDBDocumentClient` is a distinct class (extends `@smithy/core/client`, not
// `DynamoDBClient`), so the mock has to target it specifically rather than `DynamoDBClient`.
const ddbMock = mockClient(DynamoDBDocumentClient);

const ALLOWED_ORIGIN = 'http://localhost:3000';
const ORG_UUID = 'org-uuid-1';

function fakeJwt(payload: Record<string, unknown>): string {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${header}.${body}.fake-signature`;
}

function buildEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
    const identifierJwt = fakeJwt({ sub: 'user-1', name: 'Test User', email: 'user@example.com' });
    const organisationJwt = fakeJwt({ organisation_id: 'potato-rocket', user_id: 'user-1', uuid: ORG_UUID });
    return {
        httpMethod: 'GET',
        path: '/blocks',
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

const metaObject: MetaObject = {
    fields: [{ key: 'headline', name: 'Headline', field_type: 'single_line_text', required: true }],
};

const sampleBlock: Block = {
    id: 'block-1',
    title: 'Hero',
    data: { headline: 'Welcome' },
    draft: null,
    meta_object: metaObject,
};

beforeEach(() => {
    ddbMock.reset();
});

describe('GET /blocks', () => {
    it('returns 200 with all blocks for the organisation', async () => {
        ddbMock.on(QueryCommand).resolves({ Items: [{ data: sampleBlock }] });

        const res = await lambdaHandler(buildEvent({ httpMethod: 'GET', path: '/blocks' }));

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual([sampleBlock]);
        expect(ddbMock).toHaveReceivedCommandWith(QueryCommand, {
            ExpressionAttributeValues: {
                ':pk': `ORGANISATION#${ORG_UUID}#BLOCK`,
                ':sk_prefix': 'BLOCK#',
            },
        });
    });

    it('returns 401 when unauthenticated', async () => {
        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'GET', path: '/blocks', headers: { origin: ALLOWED_ORIGIN } }),
        );

        expect(res.statusCode).toBe(401);
    });

    it('returns 404 for an unknown block id', async () => {
        ddbMock.on(GetCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'GET', path: '/blocks', queryStringParameters: { id: 'nonexistent' } }),
        );

        expect(res.statusCode).toBe(404);
    });
});

describe('POST /blocks', () => {
    const createPayload = {
        title: 'Hero',
        data: { headline: 'Welcome' },
        meta_object: metaObject,
    };

    it('creates a block and returns 201', async () => {
        ddbMock.on(PutCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'POST', path: '/blocks', body: JSON.stringify(createPayload) }),
        );

        expect(res.statusCode).toBe(201);
        const body = JSON.parse(res.body);
        expect(body.title).toBe('Hero');
        expect(body.data).toEqual({ headline: 'Welcome' });
        expect(ddbMock).toHaveReceivedCommandTimes(PutCommand, 1);
    });

    it('returns 422 when the block data fails meta_object validation', async () => {
        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'POST',
                path: '/blocks',
                body: JSON.stringify({ ...createPayload, data: {} }),
            }),
        );

        expect(res.statusCode).toBe(422);
        expect(ddbMock).not.toHaveReceivedCommand(PutCommand);
    });

    it('dry-run validates a single block without writing (validate=true)', async () => {
        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'POST',
                path: '/blocks',
                queryStringParameters: { validate: 'true' },
                body: JSON.stringify({ ...createPayload, id: 'block-1' }),
            }),
        );

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ valid: true });
        expect(ddbMock).not.toHaveReceivedCommand(PutCommand);
    });
});

describe('PUT /blocks', () => {
    it('updates an existing block', async () => {
        ddbMock.on(GetCommand).resolves({ Item: { data: sampleBlock } });
        ddbMock.on(UpdateCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'PUT',
                path: '/blocks',
                queryStringParameters: { id: 'block-1' },
                body: JSON.stringify({ title: 'Updated Hero' }),
            }),
        );

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).title).toBe('Updated Hero');
    });

    it('returns 400 when the id query parameter is missing', async () => {
        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'PUT', path: '/blocks', queryStringParameters: null, body: '{}' }),
        );

        expect(res.statusCode).toBe(400);
    });
});

describe('DELETE /blocks', () => {
    it('deletes an existing block and returns 204', async () => {
        ddbMock.on(GetCommand).resolves({ Item: { data: sampleBlock } });
        ddbMock.on(DeleteCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'DELETE', path: '/blocks', queryStringParameters: { id: 'block-1' } }),
        );

        expect(res.statusCode).toBe(204);
        expect(ddbMock).toHaveReceivedCommandTimes(DeleteCommand, 1);
    });

    it('returns 404 when the block does not exist', async () => {
        ddbMock.on(GetCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'DELETE', path: '/blocks', queryStringParameters: { id: 'nonexistent' } }),
        );

        expect(res.statusCode).toBe(404);
    });
});
