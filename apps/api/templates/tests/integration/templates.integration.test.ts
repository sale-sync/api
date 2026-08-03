import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { Template } from '@sale-sync/shared/src/types';
import { lambdaHandler } from '../../app';

// `uuid@13` ships ESM-only (no CJS build) — Jest's default CommonJS require() can't load it.
// Production bundling works fine (esbuild statically bundles it); tests just stub it.
jest.mock('uuid', () => ({ v4: () => 'mocked-template-uuid' }));

const ddbMock = mockClient(DynamoDBClient);

const ALLOWED_ORIGIN = 'http://localhost:3000';

function buildEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
    return {
        httpMethod: 'GET',
        path: '/templates',
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

const sampleTemplate: Template = {
    uuid: 'template-uuid-1',
    name: 'Mandy Studio',
    business_category: 'real-estate',
    preview_image: 'templates/mandy-studio.png',
    created_at: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
    ddbMock.reset();
});

describe('GET /templates', () => {
    it('returns 200 with templates for the given category', async () => {
        ddbMock.on(QueryCommand).resolves({ Items: [{ data: JSON.stringify(sampleTemplate) }] });

        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'GET', path: '/templates', queryStringParameters: { category: 'real-estate' } }),
        );

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual([sampleTemplate]);
        expect(ddbMock).toHaveReceivedCommandWith(QueryCommand, {
            ExpressionAttributeValues: { ':pk': 'TEMPLATE', ':prefix': 'CATEGORY#real-estate#TEMPLATE#' },
        });
    });

    it('returns 400 when category is missing', async () => {
        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'GET', path: '/templates', queryStringParameters: null }),
        );

        expect(res.statusCode).toBe(400);
        expect(ddbMock).not.toHaveReceivedCommand(QueryCommand);
    });

    it('returns 400 for an invalid category', async () => {
        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'GET', path: '/templates', queryStringParameters: { category: 'not-a-category' } }),
        );

        expect(res.statusCode).toBe(400);
    });

    it('returns 401 when unauthenticated', async () => {
        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'GET', path: '/templates', headers: { origin: ALLOWED_ORIGIN } }),
        );

        expect(res.statusCode).toBe(401);
    });
});

describe('POST /templates', () => {
    const validBody = {
        name: 'Mandy Studio',
        business_category: 'real-estate',
        preview_image: 'templates/mandy-studio.png',
    };

    it('creates a template and returns 201', async () => {
        ddbMock.on(PutCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'POST', path: '/templates', body: JSON.stringify(validBody) }),
        );

        expect(res.statusCode).toBe(201);
        expect(JSON.parse(res.body)).toEqual({
            uuid: 'mocked-template-uuid',
            name: 'Mandy Studio',
            business_category: 'real-estate',
            preview_image: 'templates/mandy-studio.png',
            created_at: expect.any(String),
        });
    });

    it('returns 400 when required fields are missing', async () => {
        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'POST', path: '/templates', body: JSON.stringify({}) }),
        );

        expect(res.statusCode).toBe(400);
        expect(ddbMock).not.toHaveReceivedCommand(PutCommand);
    });
});
