import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent } from 'aws-lambda';

const authorizationUrl = jest.fn(() => 'https://staging-admin-auth.salesync.biz/oauth2/authorize?...');
const callback = jest.fn(async () => ({ access_token: 'fake-access-token' }));
const userinfo = jest.fn(async () => ({ sub: 'fake-sub', email: 'staff@salesync.biz' }));

jest.mock('openid-client', () => ({
    generators: {
        nonce: () => 'fake-nonce',
        state: () => 'fake-state',
    },
    Issuer: {
        discover: async () => ({
            Client: jest.fn().mockImplementation(() => ({
                authorizationUrl,
                callback,
                userinfo,
            })),
        }),
    },
}));

import { lambdaHandler } from '../../app';

const ddbMock = mockClient(DynamoDBClient);

const ALLOWED_ORIGIN = 'http://localhost:3003';

function buildEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
    return {
        httpMethod: 'GET',
        path: '/auth/login',
        headers: { origin: ALLOWED_ORIGIN },
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

beforeEach(() => {
    ddbMock.reset();
    process.env.TABLE_NAME = 'sale-sync-organisation';
    process.env.COGNITO_URL = 'https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_fake';
    process.env.CLIENT_ID = 'fake-client-id';
    process.env.CLIENT_SECRET = 'fake-client-secret';
    process.env.COGNITO_CALLBACK_URL = 'https://staging-admin.salesync.biz/api/auth/callback';
});

describe('POST /auth/login', () => {
    it('stores a nonce/state pair and returns the Cognito authorization URL', async () => {
        ddbMock.on(PutCommand).resolves({});

        const res = await lambdaHandler(buildEvent({ httpMethod: 'POST', path: '/auth/login' }));

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ authUrl: authorizationUrl() });
        expect(ddbMock).toHaveReceivedCommandWith(PutCommand, {
            TableName: 'sale-sync-organisation',
            Item: expect.objectContaining({ PK: 'NONCE-STATE#fake-state', SK: 'META' }),
        });
    });
});

describe('GET /auth/login (Cognito callback)', () => {
    it('exchanges the code for tokens and returns user info once the nonce matches', async () => {
        ddbMock.on(GetCommand).resolves({ Item: { data: JSON.stringify({ nonce: 'fake-nonce', state: 'fake-state' }) } });

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'GET',
                path: '/auth/login',
                queryStringParameters: { code: 'fake-code', state: 'fake-state' },
            }),
        );

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({
            tokenSet: { access_token: 'fake-access-token' },
            userInfo: { sub: 'fake-sub', email: 'staff@salesync.biz' },
        });
    });

    it('returns 400 when the state has no matching stored nonce', async () => {
        ddbMock.on(GetCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'GET',
                path: '/auth/login',
                queryStringParameters: { code: 'fake-code', state: 'unknown-state' },
            }),
        );

        expect(res.statusCode).toBe(400);
    });
});
