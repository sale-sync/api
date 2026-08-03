import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import type { Subscription } from '@sale-sync/shared/src/types';

const TABLE = process.env.ORGANISATION_TABLE_NAME || 'sale-sync-organisation';

export class SubscriptionService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('subscription');
        this.DB_Client = DB_Client;
    }

    // Get an organisation's subscription/trial record — PK=ORG#{organisation_id}, SK=SUBSCRIPTION
    public async getSubscriptionByOrganisationId(organisationId: string): Promise<Subscription | null> {
        const res = await this.DB_Client.send(
            new GetCommand({
                TableName: TABLE,
                Key: { PK: `ORG#${organisationId}`, SK: 'SUBSCRIPTION' },
            }),
        );

        return res.Item ? (JSON.parse(res.Item.data as string) as Subscription) : null;
    }
}
