import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import type { BusinessCategory, Organisation, OrganisationTemplate, Template, ThemeBrandColor, ThemeConfig, ThemeFont } from '@sales-sync/shared/src/types';
import type { UpdateThemeInput } from '@sales-sync/shared/src/dtos';

const TABLE = 'sale-sync-organisation';

const DEFAULT_BRAND_COLOR: ThemeBrandColor = 'blue';
const DEFAULT_FONT: ThemeFont = 'sans';

export class TemplateNotFoundError extends Error {
    constructor(templateUuid: string) {
        super(`Template '${templateUuid}' not found`);
        this.name = 'TemplateNotFoundError';
    }
}

export class TemplateMembershipNotFoundError extends Error {
    constructor(templateUuid: string) {
        super(`Template '${templateUuid}' is not in this organisation's collection`);
        this.name = 'TemplateMembershipNotFoundError';
    }
}

export class ActiveTemplateRemovalError extends Error {
    constructor() {
        super('Cannot remove the currently active template');
        this.name = 'ActiveTemplateRemovalError';
    }
}

export class OrganisationNotFoundError extends Error {
    constructor(orgUuid: string) {
        super(`Organisation '${orgUuid}' not found`);
        this.name = 'OrganisationNotFoundError';
    }
}

export class TemplateService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('template');
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
                    ':prefix': `CAT#${category}#TEMPLATE#`,
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
                    SK: `CAT#${category}#TEMPLATE#${uuid}`,
                },
            }),
        );

        return res.Item ? (JSON.parse(res.Item.data as string) as Template) : null;
    }

    // Add a template to an organisation (and optionally set it as active)
    // Fetches org metadata internally to resolve business_category for template lookup
    public async addToOrganisation(orgUuid: string, templateUuid: string, setActive?: boolean): Promise<void> {
        const org = await this.getOrgMetadata(orgUuid);

        const template = await this.getByUuid(templateUuid, org.business_category);
        if (!template) throw new TemplateNotFoundError(templateUuid);

        const membership: OrganisationTemplate = {
            template_uuid: templateUuid,
            added_at: new Date().toISOString(),
        };

        const theme: ThemeConfig = {
            template_uuid: templateUuid,
            brand_color: DEFAULT_BRAND_COLOR,
            font: DEFAULT_FONT,
            updated_at: membership.added_at,
        };

        const transactItems = [
            {
                Put: {
                    TableName: TABLE,
                    Item: {
                        PK: `ORG#${orgUuid}`,
                        SK: `TEMPLATE#${templateUuid}`,
                        data: JSON.stringify(membership),
                    },
                },
            },
            {
                Put: {
                    TableName: TABLE,
                    Item: {
                        PK: `ORG#${orgUuid}`,
                        SK: `THEME#${templateUuid}`,
                        data: JSON.stringify(theme),
                    },
                },
            },
            ...(setActive
                ? [
                      {
                          Update: {
                              TableName: TABLE,
                              Key: { PK: 'ORG', SK: `META#${orgUuid}` },
                              UpdateExpression: 'SET #data = :data',
                              ExpressionAttributeNames: { '#data': 'data' },
                              ExpressionAttributeValues: { ':data': JSON.stringify({ ...org, template_id: templateUuid } as Organisation) },
                          },
                      },
                  ]
                : []),
        ];

        await this.DB_Client.send(new TransactWriteCommand({ TransactItems: transactItems }));
    }

    // List all templates an organisation has added
    public async listOrganisationTemplates(orgUuid: string): Promise<Array<{ template_uuid: string; membership: OrganisationTemplate }>> {
        const res = await this.DB_Client.send(
            new QueryCommand({
                TableName: TABLE,
                KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
                ExpressionAttributeValues: {
                    ':pk': `ORG#${orgUuid}`,
                    ':prefix': 'TEMPLATE#',
                },
            }),
        );

        return (res.Items ?? []).map((item) => ({
            template_uuid: String(item.SK).replace('TEMPLATE#', ''),
            membership: JSON.parse(item.data as string) as OrganisationTemplate,
        }));
    }

    // Remove a template from an organisation (also deletes its theme config)
    public async removeFromOrganisation(orgUuid: string, templateUuid: string): Promise<void> {
        const org = await this.getOrgMetadata(orgUuid);

        if (org.template_id === templateUuid) throw new ActiveTemplateRemovalError();

        await this.DB_Client.send(
            new TransactWriteCommand({
                TransactItems: [
                    {
                        Delete: {
                            TableName: TABLE,
                            Key: { PK: `ORG#${orgUuid}`, SK: `TEMPLATE#${templateUuid}` },
                        },
                    },
                    {
                        Delete: {
                            TableName: TABLE,
                            Key: { PK: `ORG#${orgUuid}`, SK: `THEME#${templateUuid}` },
                        },
                    },
                ],
            }),
        );
    }

    // Set a template as the active template for an organisation
    public async setActive(orgUuid: string, templateUuid: string): Promise<void> {
        const membership = await this.DB_Client.send(
            new GetCommand({
                TableName: TABLE,
                Key: { PK: `ORG#${orgUuid}`, SK: `TEMPLATE#${templateUuid}` },
            }),
        );

        if (!membership.Item) throw new TemplateMembershipNotFoundError(templateUuid);

        const org = await this.getOrgMetadata(orgUuid);
        const updatedOrg: Organisation = { ...org, template_id: templateUuid };

        await this.DB_Client.send(
            new UpdateCommand({
                TableName: TABLE,
                Key: { PK: 'ORG', SK: `META#${orgUuid}` },
                UpdateExpression: 'SET #data = :data',
                ExpressionAttributeNames: { '#data': 'data' },
                ExpressionAttributeValues: { ':data': JSON.stringify(updatedOrg) },
            }),
        );
    }

    // Get the theme config for a specific org-template pair
    public async getTheme(orgUuid: string, templateUuid: string): Promise<ThemeConfig | null> {
        const res = await this.DB_Client.send(
            new GetCommand({
                TableName: TABLE,
                Key: { PK: `ORG#${orgUuid}`, SK: `THEME#${templateUuid}` },
            }),
        );

        return res.Item ? (JSON.parse(res.Item.data as string) as ThemeConfig) : null;
    }

    // Update the theme config for a specific org-template pair
    public async updateTheme(orgUuid: string, templateUuid: string, updates: Pick<UpdateThemeInput, 'brand_color' | 'font'>): Promise<ThemeConfig> {
        const existing = await this.getTheme(orgUuid, templateUuid);
        if (!existing) throw new TemplateMembershipNotFoundError(templateUuid);

        const updated: ThemeConfig = {
            ...existing,
            ...(updates.brand_color !== undefined && { brand_color: updates.brand_color }),
            ...(updates.font !== undefined && { font: updates.font }),
            updated_at: new Date().toISOString(),
        };

        await this.DB_Client.send(
            new UpdateCommand({
                TableName: TABLE,
                Key: { PK: `ORG#${orgUuid}`, SK: `THEME#${templateUuid}` },
                UpdateExpression: 'SET #data = :data',
                ExpressionAttributeNames: { '#data': 'data' },
                ExpressionAttributeValues: { ':data': JSON.stringify(updated) },
            }),
        );

        return updated;
    }

    private async getOrgMetadata(orgUuid: string): Promise<Organisation> {
        const res = await this.DB_Client.send(
            new GetCommand({
                TableName: TABLE,
                Key: { PK: 'ORG', SK: `META#${orgUuid}` },
            }),
        );

        if (!res.Item) throw new OrganisationNotFoundError(orgUuid);

        return JSON.parse(res.Item.data as string) as Organisation;
    }
}
