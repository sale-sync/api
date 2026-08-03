import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import type { Subscription } from '@sale-sync/shared/src/types';
import { v4 as uuidv4 } from 'uuid';

const TABLE = 'sale-sync-organisation';

type CreateSubscriptionParam = {
    organisation_id: string;
    plan_id: string;
    trial_start: string;
    trial_end: string;
};

type UpdateSubscriptionParam = {
    organisation_id: string;
    plan_id?: string;
    trial_end?: string;
    status?: Subscription['status'];
    payment_method?: Subscription['payment_method'];
    activated_by?: Subscription['activated_by'];
    activated_at?: Subscription['activated_at'];
};

export class SubscriptionAlreadyExistsError extends Error {
    constructor(organisationId: string) {
        super(`Subscription for organisation '${organisationId}' already exists`);
        this.name = 'SubscriptionAlreadyExistsError';
    }
}

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

    // Create the singleton subscription record for an organisation — one per org, rejects duplicates
    public async createSubscription(param: CreateSubscriptionParam): Promise<Subscription> {
        const now = new Date().toISOString();
        const subscription: Subscription = {
            uuid: uuidv4(),
            organisation_id: param.organisation_id,
            plan_id: param.plan_id,
            trial_start: param.trial_start,
            trial_end: param.trial_end,
            status: 'trialing',
            payment_method: null,
            activated_by: null,
            activated_at: null,
            promo_code: null,
            discount_type: null,
            discount_value: null,
            created_at: now,
            updated_at: now,
        };

        try {
            await this.DB_Client.send(
                new PutCommand({
                    TableName: TABLE,
                    Item: {
                        PK: `ORG#${param.organisation_id}`,
                        SK: 'SUBSCRIPTION',
                        // Feeds the `trial-status-index` sparse GSI (infra/functions/check-trial-lapses)
                        // — always set on create, since every subscription starts 'trialing'.
                        GSI2PK: 'SUBSCRIPTION#TRIALING',
                        GSI2SK: subscription.trial_end,
                        data: JSON.stringify(subscription),
                    },
                    ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
                }),
            );
        } catch (error) {
            if (error && typeof error === 'object' && 'name' in error && error.name === 'ConditionalCheckFailedException') {
                throw new SubscriptionAlreadyExistsError(param.organisation_id);
            }
            throw error;
        }

        return subscription;
    }

    // Update a subscription record — status transitions (e.g. past_due -> active), plan changes, payment method
    public async updateSubscription(param: UpdateSubscriptionParam): Promise<Subscription | null> {
        const existing = await this.getSubscriptionByOrganisationId(param.organisation_id);
        if (!existing) return null;

        const updated: Subscription = {
            ...existing,
            ...(param.plan_id !== undefined && { plan_id: param.plan_id }),
            ...(param.trial_end !== undefined && { trial_end: param.trial_end }),
            ...(param.status !== undefined && { status: param.status }),
            ...(param.payment_method !== undefined && { payment_method: param.payment_method }),
            ...(param.activated_by !== undefined && { activated_by: param.activated_by }),
            ...(param.activated_at !== undefined && { activated_at: param.activated_at }),
            updated_at: new Date().toISOString(),
        };

        // Keep the `trial-status-index` sparse GSI (infra/functions/check-trial-lapses) in sync:
        // SET GSI2PK/GSI2SK while still 'trialing' (e.g. a trial extension updates GSI2SK too),
        // REMOVE them the moment status moves elsewhere so the index only ever holds active trials.
        const names: Record<string, string> = { '#data': 'data' };
        const values: Record<string, unknown> = { ':data': JSON.stringify(updated) };
        let updateExpression = 'SET #data = :data';

        if (updated.status === 'trialing') {
            updateExpression += ', GSI2PK = :gsi2pk, GSI2SK = :gsi2sk';
            values[':gsi2pk'] = 'SUBSCRIPTION#TRIALING';
            values[':gsi2sk'] = updated.trial_end;
        } else {
            updateExpression += ' REMOVE GSI2PK, GSI2SK';
        }

        await this.DB_Client.send(
            new UpdateCommand({
                TableName: TABLE,
                Key: { PK: `ORG#${param.organisation_id}`, SK: 'SUBSCRIPTION' },
                UpdateExpression: updateExpression,
                ExpressionAttributeNames: names,
                ExpressionAttributeValues: values,
                ConditionExpression: 'attribute_exists(PK)',
            }),
        );

        return updated;
    }
}
