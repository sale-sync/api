import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import type { BusinessCategory, Template } from '@sale-sync/shared/src/types';
import { v4 as uuidv4 } from 'uuid';

const TABLE = process.env.ORGANISATION_TABLE_NAME || 'sale-sync-organisation';

type CreateTemplateParam = {
    name: string;
    business_category: BusinessCategory;
    preview_image: string;
};

export class TemplateService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('template');
        this.DB_Client = DB_Client;
    }

    public async createTemplate(param: CreateTemplateParam): Promise<Template> {
        const template: Template = {
            uuid: uuidv4(),
            name: param.name,
            business_category: param.business_category,
            preview_image: param.preview_image,
            created_at: new Date().toISOString(),
        };

        await this.DB_Client.send(
            new PutCommand({
                TableName: TABLE,
                Item: {
                    PK: 'TEMPLATE',
                    SK: `CATEGORY#${template.business_category}#TEMPLATE#${template.uuid}`,
                    data: JSON.stringify(template),
                },
                ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
            }),
        );

        return template;
    }

    public async listByCategory(category: BusinessCategory): Promise<Template[]> {
        const res = await this.DB_Client.send(
            new QueryCommand({
                TableName: TABLE,
                KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
                ExpressionAttributeValues: {
                    ':pk': 'TEMPLATE',
                    ':prefix': `CATEGORY#${category}#TEMPLATE#`,
                },
            }),
        );

        return (res.Items ?? []).map((item) => JSON.parse(item.data as string) as Template);
    }
}
