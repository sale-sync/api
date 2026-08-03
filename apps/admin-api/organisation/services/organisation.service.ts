import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import type { Organisation } from '@sale-sync/shared/src/types';

const TABLE = 'sale-sync-organisation';

const DEFAULT_LIMIT = 50;

type ListOrganisationsResult = {
    items: Organisation[];
    lastKey?: string;
};

type UpdateOrganisationParam = {
    uuid: string;
    status?: Organisation['status'];
    plan_id?: string;
};

export class OrganisationService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('organisation');
        this.DB_Client = DB_Client;
    }

    // List all organisations — PK=ORG, SK begins_with META#, paginated
    public async listOrganisations(lastKey?: string, limit = DEFAULT_LIMIT): Promise<ListOrganisationsResult> {
        const res = await this.DB_Client.send(
            new QueryCommand({
                TableName: TABLE,
                KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
                ExpressionAttributeValues: {
                    ':pk': 'ORG',
                    ':prefix': 'META#',
                },
                Limit: limit,
                ...(lastKey && {
                    ExclusiveStartKey: { PK: 'ORG', SK: lastKey },
                }),
            }),
        );

        const items = (res.Items ?? []).map((item) => JSON.parse(item.data as string) as Organisation);
        const nextLastKey = res.LastEvaluatedKey ? (res.LastEvaluatedKey.SK as string) : undefined;

        return { items, lastKey: nextLastKey };
    }

    // Get organisation by slug — PK=ORG#ID#${id}, SK=META → uuid → metadata
    public async getOrganisationById(orgId: string): Promise<Organisation | null> {
        const lookup = await this.DB_Client.send(
            new GetCommand({
                TableName: TABLE,
                Key: { PK: `ORG#ID#${orgId}`, SK: 'META' },
            }),
        );

        if (!lookup.Item) return null;

        const meta = await this.DB_Client.send(
            new GetCommand({
                TableName: TABLE,
                Key: { PK: 'ORG', SK: `META#${lookup.Item.uuid}` },
            }),
        );

        return meta.Item ? (JSON.parse(meta.Item.data) as Organisation) : null;
    }

    // Update organisation status or plan_id — UpdateCommand on PK=ORG, SK=META#{uuid}
    public async updateOrganisation(param: UpdateOrganisationParam): Promise<boolean> {
        const existing = await this.DB_Client.send(
            new GetCommand({
                TableName: TABLE,
                Key: { PK: 'ORG', SK: `META#${param.uuid}` },
            }),
        );

        if (!existing.Item) return false;

        const org = JSON.parse(existing.Item.data as string) as Organisation;

        const updated: Organisation = {
            ...org,
            ...(param.status !== undefined && { status: param.status }),
            ...(param.plan_id !== undefined && { plan_id: param.plan_id }),
        };

        await this.DB_Client.send(
            new UpdateCommand({
                TableName: TABLE,
                Key: { PK: 'ORG', SK: `META#${param.uuid}` },
                UpdateExpression: 'SET #data = :data',
                ExpressionAttributeNames: { '#data': 'data' },
                ExpressionAttributeValues: { ':data': JSON.stringify(updated) },
                ConditionExpression: 'attribute_exists(PK)',
            }),
        );

        return true;
    }
}
