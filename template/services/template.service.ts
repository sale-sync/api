import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import type { BusinessCategory, Template } from '@sales-sync/shared/src/types';

const TABLE = 'sale-sync-organisation';

export class TemplateService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('template');
        this.DB_Client = DB_Client;
    }

    public async listByCategory(category: BusinessCategory): Promise<Template[]> {
        const res = await this.DB_Client.send(
            new QueryCommand({
                TableName: TABLE,
                KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
                ExpressionAttributeValues: {
                    ':pk': 'TEMPLATE',
                    ':prefix': `CAT#${category}#TEMPLATE#`,
                },
            }),
        );

        return (res.Items ?? []).map((item) => JSON.parse(item.data as string) as Template);
    }
}
