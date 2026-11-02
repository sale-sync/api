import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { lambdaHandler } from '../../app';

// The Cognito OIDC exchange (`openid-client`) is mocked at the module boundary — it always makes
// real network calls (discovery + token/userinfo endpoints), so unlike the DynamoDB side there's
// no SDK-client seam to intercept. DynamoDB itself (nonce/state storage) is still mocked at the
// real `DynamoDBClient` boundary via aws-sdk-client-mock, same as the other integration suites.
const mockAuthorizationUrl = jest.fn();
const mockCallback = jest.fn();
const mockUserinfo = jest.fn();
const mockNonce = jest.fn();
const mockState = jest.fn();

jest.mock('openid-client', () => ({
    generators: {
        nonce: (...args: unknown[]) => mockNonce(...args),
        state: (...args: unknown[]) => mockState(...args),
    },
    Issuer: {
        discover: jest.fn().mockResolvedValue({
            Client: class {
                authorizationUrl(...args: unknown[]) {
                    return mockAuthorizationUrl(...args);
                }
                callback(...args: unknown[]) {
                    return mockCallback(...args);
                }
                userinfo(...args: unknown[]) {
                    return mockUserinfo(...args);
                }
            },
        }),
    },
}));

const ddbMock = mockClient(DynamoDBClient);

const ALLOWED_ORIGIN = 'http://localhost:3000';

function buildEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
    return {
        httpMethod: 'POST',
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
    jest.clearAllMocks();
    process.env.AUTH_TABLE_NAME = 'sale-sync-auth';
    process.env.COGNITO_URL = 'https://cognito.example.com';
    process.env.CLIENT_ID = 'test-client-id';
    process.env.CLIENT_SECRET = 'test-client-secret';
    process.env.COGNITO_CALLBACK_URL = 'https://app.salesync.local/auth/callback';
});

describe('POST /auth/login', () => {
    it('stores a nonce/state pair and returns the Cognito authorization URL', async () => {
        mockNonce.mockReturnValue('fixed-nonce');
        mockState.mockReturnValue('fixed-state');
        mockAuthorizationUrl.mockReturnValue('https://cognito.example.com/authorize?state=fixed-state');
        ddbMock.on(PutCommand).resolves({});

        const res = await lambdaHandler(buildEvent({ httpMethod: 'POST', path: '/auth/login' }));

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({
            authUrl: 'https://cognito.example.com/authorize?state=fixed-state',
        });
        expect(ddbMock).toHaveReceivedCommandWith(PutCommand, {
            TableName: 'sale-sync-auth',
            Item: {
                PK: 'NONCE-STATE#fixed-state',
                SK: 'fixed-state',
                data: JSON.stringify({
                    nonce: 'fixed-nonce',
                    state: 'fixed-state',
                    redirectUri: 'https://app.salesync.local/auth/callback',
                }),
            },
        });
    });

    it('uses the callback URL of the app the user came from (?app=) and stores it with the nonce', async () => {
        process.env.COGNITO_CALLBACK_URLS =
            'estate=https://estate.silastech.co/auth/callback,trade=https://app.silastech.co/auth/callback';
        mockNonce.mockReturnValue('fixed-nonce');
        mockState.mockReturnValue('fixed-state');
        mockAuthorizationUrl.mockReturnValue('https://cognito.example.com/authorize?state=fixed-state');
        ddbMock.on(PutCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'POST', path: '/auth/login', queryStringParameters: { app: 'trade' } }),
        );

        expect(res.statusCode).toBe(200);
        expect(mockAuthorizationUrl).toHaveBeenCalledWith(
            expect.objectContaining({ redirect_uri: 'https://app.silastech.co/auth/callback' }),
        );
        expect(ddbMock).toHaveReceivedCommandWith(PutCommand, {
            Item: expect.objectContaining({
                data: JSON.stringify({
                    nonce: 'fixed-nonce',
                    state: 'fixed-state',
                    redirectUri: 'https://app.silastech.co/auth/callback',
                }),
            }),
        });
        delete process.env.COGNITO_CALLBACK_URLS;
    });

    it('returns 400 for an app that is not in COGNITO_CALLBACK_URLS and stores nothing', async () => {
        process.env.COGNITO_CALLBACK_URLS = 'estate=https://estate.silastech.co/auth/callback';

        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'POST', path: '/auth/login', queryStringParameters: { app: 'evil' } }),
        );

        expect(res.statusCode).toBe(400);
        expect(ddbMock).not.toHaveReceivedCommand(PutCommand);
        delete process.env.COGNITO_CALLBACK_URLS;
    });
});

describe('GET /auth/login (Cognito callback)', () => {
    it('returns "No param found" when the callback has no query params', async () => {
        const res = await lambdaHandler(
            buildEvent({ httpMethod: 'GET', path: '/auth/login', queryStringParameters: null }),
        );

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ message: 'No param found' });
        expect(ddbMock).not.toHaveReceivedCommand(GetCommand);
    });

    it('exchanges the code for tokens when the state matches a stored nonce', async () => {
        ddbMock.on(GetCommand).resolves({
            Item: { data: JSON.stringify({ nonce: 'fixed-nonce', state: 'fixed-state' }) },
        });
        mockCallback.mockResolvedValue({ access_token: 'fake-access-token' });
        mockUserinfo.mockResolvedValue({ sub: 'user-1', email: 'user@example.com' });

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'GET',
                path: '/auth/login',
                queryStringParameters: { code: 'auth-code', state: 'fixed-state' },
            }),
        );

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({
            tokenSet: { access_token: 'fake-access-token' },
            userInfo: { sub: 'user-1', email: 'user@example.com' },
        });
        expect(ddbMock).toHaveReceivedCommandWith(GetCommand, {
            TableName: 'sale-sync-auth',
            Key: { PK: 'NONCE-STATE#fixed-state', SK: 'fixed-state' },
        });
    });

    it('exchanges the code with the redirect URI stored at login, not the configured default', async () => {
        ddbMock.on(GetCommand).resolves({
            Item: {
                data: JSON.stringify({
                    nonce: 'fixed-nonce',
                    state: 'fixed-state',
                    redirectUri: 'https://app.silastech.co/auth/callback',
                }),
            },
        });
        mockCallback.mockResolvedValue({ access_token: 'fake-access-token' });
        mockUserinfo.mockResolvedValue({ sub: 'user-1' });

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'GET',
                path: '/auth/login',
                queryStringParameters: { code: 'auth-code', state: 'fixed-state' },
            }),
        );

        expect(res.statusCode).toBe(200);
        expect(mockCallback).toHaveBeenCalledWith(
            'https://app.silastech.co/auth/callback',
            { code: 'auth-code', state: 'fixed-state' },
            { nonce: 'fixed-nonce', state: 'fixed-state' },
        );
    });

    it('returns 400 when the state does not match a stored nonce', async () => {
        ddbMock.on(GetCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent({
                httpMethod: 'GET',
                path: '/auth/login',
                queryStringParameters: { code: 'auth-code', state: 'unknown-state' },
            }),
        );

        expect(res.statusCode).toBe(400);
        expect(mockCallback).not.toHaveBeenCalled();
    });
});

describe('CORS', () => {
    it('short-circuits an OPTIONS preflight request with 204', async () => {
        const res = await lambdaHandler(buildEvent({ httpMethod: 'OPTIONS', path: '/auth/login' }));

        expect(res.statusCode).toBe(204);
    });
});
