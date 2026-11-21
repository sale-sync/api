import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import type { BusinessCategory, Organisation, OrganisationTemplate, Template } from '@sale-sync/shared/src/types';
import { WebsiteTemplateService } from './website-template.service';

const TABLE = process.env.ORGANISATION_TABLE_NAME || 'sale-sync-organisation';

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
    private catalogue: WebsiteTemplateService;

    constructor(DB_Client: DynamoDBClient) {
        super('template');
        this.DB_Client = DB_Client;
        this.catalogue = new WebsiteTemplateService(DB_Client);
    }

    // List global template catalogue by business category — delegates to WebsiteTemplateService
    // (WebsiteTable), which superseded OrganisationTable as the catalogue's home. Kept as a
    // pass-through here so TemplatesController's DI wiring didn't need to change.
    public async listByCategory(category: BusinessCategory): Promise<Template[]> {
        return this.catalogue.listByCategory(category);
    }

    // Get a single template from the global catalogue — see listByCategory's note above.
    public async getByUuid(uuid: string, category: BusinessCategory): Promise<Template | null> {
        return this.catalogue.getByUuid(uuid, category);
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

    // Remove a template from an organisation
    public async removeFromOrganisation(orgUuid: string, templateUuid: string): Promise<void> {
        const org = await this.getOrgMetadata(orgUuid);

        if (org.template_id === templateUuid) throw new ActiveTemplateRemovalError();

        await this.DB_Client.send(
            new DeleteCommand({
                TableName: TABLE,
                Key: { PK: `ORG#${orgUuid}`, SK: `TEMPLATE#${templateUuid}` },
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
