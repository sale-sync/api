import { ConditionalCheckFailedException, DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import type { Plan } from '@sale-sync/shared/src/types';
import { v4 as uuidv4 } from 'uuid';

const TABLE = 'sale-sync-organisation';

type CreatePlanParam = {
    plan_id: string;
    name: string;
    info: string;
    included: string[];
    price: number;
    currency: string;
    billing_interval: 'yearly';
};

type UpdatePlanParam = {
    uuid: string;
    name?: string;
    info?: string;
    included?: string[];
    price?: number;
    currency?: string;
};

export class PlanAlreadyExistsError extends Error {
    constructor(planId: string) {
        super(`Plan '${planId}' already exists`);
        this.name = 'PlanAlreadyExistsError';
    }
}

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

        return this.getPlanByUuid(lookup.Item.uuid as string);
    }

    // Create plan — TransactWrite both items, conditional to reject duplicates
    public async createPlan(param: CreatePlanParam): Promise<string> {
        const uuid = uuidv4();
        const plan: Plan = {
            uuid,
            plan_id: param.plan_id,
            name: param.name,
            info: param.info,
            included: param.included,
            price: param.price,
            currency: param.currency,
            billing_interval: param.billing_interval,
        };

        try {
            await this.DB_Client.send(
                new TransactWriteCommand({
                    TransactItems: [
                        // Plan metadata — PK=PLAN, SK=META#{uuid}
                        {
                            Put: {
                                TableName: TABLE,
                                Item: { PK: 'PLAN', SK: `META#${uuid}`, data: JSON.stringify(plan) },
                                ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
                            },
                        },
                        // Slug uniqueness / slug→uuid lookup — PK=PLAN#ID#${plan_id}, SK=META
                        {
                            Put: {
                                TableName: TABLE,
                                Item: { PK: `PLAN#ID#${param.plan_id}`, SK: 'META', uuid },
                                ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
                            },
                        },
                    ],
                }),
            );
        } catch (error: unknown) {
            if (
                error instanceof TransactionCanceledException &&
                error.CancellationReasons?.some((r) => r.Code === 'ConditionalCheckFailed')
            ) {
                throw new PlanAlreadyExistsError(param.plan_id);
            }
            throw error;
        }

        return uuid;
    }

    // Update plan — UpdateCommand on PK=PLAN, SK=META#{uuid}
    public async updatePlan(param: UpdatePlanParam): Promise<void> {
        const existing = await this.getPlanByUuid(param.uuid);
        if (!existing) return;

        const updated: Plan = {
            ...existing,
            ...(param.name !== undefined && { name: param.name }),
            ...(param.info !== undefined && { info: param.info }),
            ...(param.included !== undefined && { included: param.included }),
            ...(param.price !== undefined && { price: param.price }),
            ...(param.currency !== undefined && { currency: param.currency }),
        };

        await this.DB_Client.send(
            new UpdateCommand({
                TableName: TABLE,
                Key: { PK: 'PLAN', SK: `META#${param.uuid}` },
                UpdateExpression: 'SET #data = :data',
                ExpressionAttributeNames: { '#data': 'data' },
                ExpressionAttributeValues: { ':data': JSON.stringify(updated) },
                ConditionExpression: 'attribute_exists(PK)',
            }),
        );
    }

    // Delete plan — TransactWrite deletes both metadata and slug items
    public async deletePlan(planId: string): Promise<boolean> {
        const lookup = await this.DB_Client.send(
            new GetCommand({
                TableName: TABLE,
                Key: { PK: `PLAN#ID#${planId}`, SK: 'META' },
            }),
        );

        if (!lookup.Item) return false;

        const uuid = lookup.Item.uuid as string;

        await this.DB_Client.send(
            new TransactWriteCommand({
                TransactItems: [
                    { Delete: { TableName: TABLE, Key: { PK: 'PLAN', SK: `META#${uuid}` } } },
                    { Delete: { TableName: TABLE, Key: { PK: `PLAN#ID#${planId}`, SK: 'META' } } },
                ],
            }),
        );

        return true;
    }
}
