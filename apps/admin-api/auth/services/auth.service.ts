import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import * as oc from 'openid-client';

// No hardcoded fallback: staging and prod are different literal tables (see
// admin.samconfig.toml) — a default here would mean a misconfigured staging deploy silently writes
// to prod instead of erroring. Read lazily (not hoisted to a module-level const) so it reflects
// process.env at call time, same as this file's Cognito env vars below.
function getTable(): string {
    return process.env.ORGANISATION_TABLE_NAME as string;
}

export interface IAuthService {
    storeNonce: () => Promise<string>;
    getNonce: (state: string) => Promise<NoncePair | null>;
    cognitoCallback(params: any): Promise<CognitoCallbackRes | null>;
}

export type NoncePair = {
    nonce: string;
    state: string;
};

export type CognitoCallbackRes = {
    userInfo: any;
    tokenSet: any;
};

// Nonce/state CSRF bookkeeping is stored in admin-api's existing OrganisationTableName
// (sale-sync-organisation) under its own PK prefix, rather than a dedicated
// auth table — admin-api has no separate auth table today (unlike
// ss/api/apps/api/auth, which uses sale-sync-auth), and this keeps the
// pool-swap to a config-only change (no new infra).
export class AuthService extends Service implements IAuthService {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('auth');
        this.DB_Client = DB_Client;
    }

    public async storeNonce() {
        const nonce = oc.generators.nonce();
        const state = oc.generators.state();
        const param = {
            nonce,
            state,
        };
        const Item = {
            PK: 'NONCE-STATE#' + param.state,
            SK: 'META',
            data: JSON.stringify(param),
        };
        const command = new PutCommand({
            TableName: getTable(),
            Item,
        });
        const { COGNITO_CALLBACK_URL } = process.env;
        const config = {
            scope: 'email openid phone profile',
            state: state,
            nonce: nonce,
            redirect_uri: COGNITO_CALLBACK_URL ?? '',
        };
        const client = await this.initializeClient();
        const authUrl = client.authorizationUrl(config);
        await this.DB_Client.send(command);
        return authUrl;
    }

    private async initializeClient() {
        const { CLIENT_SECRET, CLIENT_ID, COGNITO_CALLBACK_URL, COGNITO_URL } = process.env;
        const issuer = await oc.Issuer.discover(COGNITO_URL ?? '');
        const configs = {
            client_id: CLIENT_ID ?? '',
            client_secret: CLIENT_SECRET ?? '',
            redirect_uris: [COGNITO_CALLBACK_URL ?? ''],
            response_types: ['code'],
        };
        const client = new issuer.Client(configs);
        return client;
    }

    public async getNonce(state: string): Promise<NoncePair | null> {
        try {
            const command = new GetCommand({
                TableName: getTable(),
                Key: {
                    PK: 'NONCE-STATE#' + state,
                    SK: 'META',
                },
            });

            const { Item } = await this.DB_Client.send(command);

            if (!Item) {
                return null;
            }

            return JSON.parse(Item.data) as NoncePair;
        } catch (err) {
            console.error('Failed to get nonce', err);
            return null;
        }
    }

    public async cognitoCallback(params: any): Promise<CognitoCallbackRes | null> {
        try {
            const state = params.state;
            const { COGNITO_CALLBACK_URL } = process.env;
            if (typeof state !== 'string') return null;
            const noncePair = await this.getNonce(state);
            if (!noncePair) return null;
            const client = await this.initializeClient();
            const tokenSet = await client.callback(COGNITO_CALLBACK_URL ?? '', params, { ...noncePair });
            if (!tokenSet) return null;
            const userInfo = await client.userinfo(tokenSet.access_token ?? '');
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
