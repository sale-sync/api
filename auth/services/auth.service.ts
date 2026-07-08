import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import * as oc from 'openid-client';

export interface IAuthService {
    check: () => void;
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

export class AuthService extends Service implements IAuthService {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('auth');
        this.DB_Client = DB_Client;
    }

    public check() {
        console.log('auth service inject successfully');
    }

    public async storeNonce() {
        const nonce = oc.generators.nonce();
        const state = oc.generators.state();
        const param = {
            nonce,
            state,
        };
        const Item = {
            pk: 'NONCE-STATE#' + param.state,
            sk: param.state,
            data: JSON.stringify(param),
        };
        const command = new PutCommand({
            TableName: process.env.AUTH_TABLE_NAME || 'sale-sync-auth',
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
        console.log({ authUrl });
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
        console.log({ configs });
        const client = new issuer.Client(configs);
        return client;
    }

    public async getNonce(state: string): Promise<NoncePair | null> {
        try {
            const command = new GetCommand({
                TableName: process.env.AUTH_TABLE_NAME || 'sale-sync-auth',
                Key: {
                    pk: 'NONCE-STATE#' + state,
                    sk: state,
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
            console.log({ params });
            const { COGNITO_CALLBACK_URL } = process.env;
            if (typeof state !== 'string') return null;
            const noncePair = await this.getNonce(state);
            if (!noncePair) return null;
            const client = await this.initializeClient();
            console.log({ COGNITO_CALLBACK_URL });
            const tokenSet = await client.callback(COGNITO_CALLBACK_URL ?? '', params, { ...noncePair });
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
