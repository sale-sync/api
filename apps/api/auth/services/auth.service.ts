import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import * as oc from 'openid-client';

export interface IAuthService {
    check: () => void;
    storeNonce: (app?: string) => Promise<string | null>;
    getNonce: (state: string) => Promise<StoredNonce | null>;
    cognitoCallback(params: any): Promise<CognitoCallbackRes | null>;
}

export type NoncePair = {
    nonce: string;
    state: string;
};

// What is stored for a login attempt: the nonce/state pair plus the redirect URI the login started with.
// The token exchange must use that same redirect URI (OAuth), so it is kept with the nonce.
export type StoredNonce = NoncePair & {
    redirectUri?: string;
};

export type CognitoCallbackRes = {
    userInfo: any;
    tokenSet: any;
};

/**
 * Callback URL per app, from env COGNITO_CALLBACK_URLS as `app=url` pairs, comma separated, e.g.
 * `estate=https://estate.silastech.co/auth/callback,trade=https://app.silastech.co/auth/callback`.
 * Only urls listed here can be used, so a login can never be sent to an arbitrary redirect.
 */
export function parseCallbackUrls(raw: string | undefined): Record<string, string> {
    const map: Record<string, string> = {};
    for (const pair of (raw ?? '').split(',')) {
        const index = pair.indexOf('=');
        if (index < 1) continue;
        const app = pair.slice(0, index).trim();
        const url = pair.slice(index + 1).trim();
        if (app && url) map[app] = url;
    }
    return map;
}

/**
 * The callback URL for the app the user came from. No app falls back to the single COGNITO_CALLBACK_URL
 * (the existing Real Estate dashboard). An app that is not listed returns null.
 */
export function resolveCallbackUrl(app: string | undefined): string | null {
    if (!app) return process.env.COGNITO_CALLBACK_URL ?? '';
    return parseCallbackUrls(process.env.COGNITO_CALLBACK_URLS)[app] ?? null;
}

export class AuthService extends Service implements IAuthService {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('auth');
        this.DB_Client = DB_Client;
    }

    public check() {
        console.log('auth service inject successfully');
    }

    public async storeNonce(app?: string) {
        const redirectUri = resolveCallbackUrl(app);
        if (redirectUri === null) return null;
        const nonce = oc.generators.nonce();
        const state = oc.generators.state();
        const param: StoredNonce = {
            nonce,
            state,
            redirectUri,
        };
        const Item = {
            PK: 'NONCE-STATE#' + param.state,
            SK: param.state,
            data: JSON.stringify(param),
        };
        const command = new PutCommand({
            TableName: process.env.AUTH_TABLE_NAME || 'sale-sync-auth',
            Item,
        });
        const config = {
            scope: 'email openid phone profile',
            state: state,
            nonce: nonce,
            redirect_uri: redirectUri,
        };
        const client = await this.initializeClient(redirectUri);
        const authUrl = client.authorizationUrl(config);
        console.log({ authUrl });
        await this.DB_Client.send(command);
        return authUrl;
    }

    private async initializeClient(redirectUri: string) {
        const { CLIENT_SECRET, CLIENT_ID, COGNITO_URL } = process.env;
        const issuer = await oc.Issuer.discover(COGNITO_URL ?? '');
        const configs = {
            client_id: CLIENT_ID ?? '',
            client_secret: CLIENT_SECRET ?? '',
            redirect_uris: [redirectUri],
            response_types: ['code'],
        };
        console.log({ configs });
        const client = new issuer.Client(configs);
        return client;
    }

    public async getNonce(state: string): Promise<StoredNonce | null> {
        try {
            const command = new GetCommand({
                TableName: process.env.AUTH_TABLE_NAME || 'sale-sync-auth',
                Key: {
                    PK: 'NONCE-STATE#' + state,
                    SK: state,
                },
            });

            const { Item } = await this.DB_Client.send(command);

            if (!Item) {
                return null;
            }

            return JSON.parse(Item.data) as StoredNonce;
        } catch (err) {
            console.error('Failed to get nonce', err);
            return null;
        }
    }

    public async cognitoCallback(params: any): Promise<CognitoCallbackRes | null> {
        try {
            const state = params.state;
            console.log({ params });
            if (typeof state !== 'string') return null;
            const stored = await this.getNonce(state);
            if (!stored) return null;
            // The redirect URI the login started with; rows stored before this change have none.
            const redirectUri = stored.redirectUri ?? process.env.COGNITO_CALLBACK_URL ?? '';
            const client = await this.initializeClient(redirectUri);
            console.log({ redirectUri });
            const tokenSet = await client.callback(redirectUri, params, { nonce: stored.nonce, state: stored.state });
            console.log({ tokenSet });
            if (!tokenSet) return null;
            const userInfo = await client.userinfo(tokenSet.access_token ?? '');
            console.log({ userInfo });
            return {
                tokenSet,
                userInfo,
            };
        } catch (error) {
            console.error(`cognitoCallback: ${JSON.stringify(error)}`);
            return null;
        }
    }
}
