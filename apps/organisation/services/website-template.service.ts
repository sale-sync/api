import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import type { BusinessCategory, PredefinedTheme, Template } from '@sale-sync/shared/src/types';

const TABLE = process.env.WEBSITE_TABLE_NAME || 'sale-sync-website';

// Reads the global template catalogue and per-template predefined themes from WebsiteTable
// (sale-sync-website). See backlogs/website/children/website-table-templates-themes — this
// supersedes the catalogue rows that used to live in OrganisationTable.
export class WebsiteTemplateService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('website-template');
        this.DB_Client = DB_Client;
    }

    // List global template catalogue by business category
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

    // Get a single template from the global catalogue
    public async getByUuid(uuid: string, category: BusinessCategory): Promise<Template | null> {
        const res = await this.DB_Client.send(
            new GetCommand({
                TableName: TABLE,
                Key: {
                    PK: 'TEMPLATE',
                    SK: `CATEGORY#${category}#TEMPLATE#${uuid}`,
                },
            }),
        );

        return res.Item ? (JSON.parse(res.Item.data as string) as Template) : null;
    }

    // List every staff-curated predefined theme for a template
    public async listThemesByTemplate(templateUuid: string): Promise<PredefinedTheme[]> {
        const res = await this.DB_Client.send(
            new QueryCommand({
                TableName: TABLE,
                KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
                ExpressionAttributeValues: {
                    ':pk': `TEMPLATE#${templateUuid}`,
                    ':prefix': 'THEME#',
                },
            }),
        );

        return (res.Items ?? []).map((item) => JSON.parse(item.data as string) as PredefinedTheme);
    }

    // Get a single predefined theme
    public async getTheme(templateUuid: string, themeUuid: string): Promise<PredefinedTheme | null> {
        const res = await this.DB_Client.send(
            new GetCommand({
                TableName: TABLE,
                Key: { PK: `TEMPLATE#${templateUuid}`, SK: `THEME#${themeUuid}` },
            }),
        );

        return res.Item ? (JSON.parse(res.Item.data as string) as PredefinedTheme) : null;
    }
}
