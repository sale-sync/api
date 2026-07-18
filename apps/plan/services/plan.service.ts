import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import type { Plan } from '@sale-sync/shared/src/types';

const TABLE = process.env.ORGANISATION_TABLE_NAME || 'sale-sync-organisation';

export class PlanService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('plan');
        this.DB_Client = DB_Client;
    }

    // List all plans — PK=PLAN, SK begins_with META#
    public async listPlans(): Promise<Plan[]> {
        const res = await this.DB_Client.send(
            new QueryCommand({
                TableName: TABLE,
                KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
                ExpressionAttributeValues: {
                    ':pk': 'PLAN',
                    ':prefix': 'META#',
                },
            }),
        );

        return (res.Items ?? []).map((item) => JSON.parse(item.data as string) as Plan);
    }

    // Get plan by UUID — PK=PLAN, SK=META#{uuid}
    public async getPlanByUuid(uuid: string): Promise<Plan | null> {
        const res = await this.DB_Client.send(
            new GetCommand({
                TableName: TABLE,
                Key: { PK: 'PLAN', SK: `META#${uuid}` },
            }),
        );

        return res.Item ? (JSON.parse(res.Item.data as string) as Plan) : null;
    }

    // Get plan by slug — PK=PLAN#ID#${planId}, SK=META → resolves uuid → metadata
    public async getPlanById(planId: string): Promise<Plan | null> {
        const lookup = await this.DB_Client.send(
            new GetCommand({
                TableName: TABLE,
                Key: { PK: `PLAN#ID#${planId}`, SK: 'META' },
            }),
        );

        if (!lookup.Item) return null;

        const { uuid } = JSON.parse(lookup.Item.data as string) as { uuid: string };
        return this.getPlanByUuid(uuid);
    }
}
