import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import type { PromoCode, PromoCodeStatus, PromoCodeType, Subscription } from '@sale-sync/shared/src/types';

// No hardcoded fallback: staging (`staging-sale-sync-organisation`) and prod
// (`sale-sync-organisation`) are different literal tables — a default here would mean a misconfigured
// staging deploy silently writes to the prod table instead of erroring. Read lazily (not hoisted to a
// module-level const) so a test's env var setup (which runs after this module is first imported) is
// still picked up.
function getTable(): string {
    return process.env.ORGANISATION_TABLE_NAME as string;
}

type TransactItem = NonNullable<TransactWriteCommandInput['TransactItems']>[number];

export class InvalidPromoCodeError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'InvalidPromoCodeError';
    }
}

// max_redemptions/expires_at are OMITTED from the item entirely (not stored as DynamoDB NULL)
// when unlimited/never-expiring — attribute_not_exists() checks in the redemption
// ConditionExpression rely on that. Reconstruct the API-facing `null` here on read.
function itemToPromoCode(item: Record<string, unknown>): PromoCode {
    return {
        uuid: item.uuid as string,
        code: item.code as string,
        type: item.type as PromoCodeType,
        value: item.value as number,
        max_redemptions: (item.max_redemptions as number | undefined) ?? null,
        redemption_count: (item.redemption_count as number | undefined) ?? 0,
        expires_at: (item.expires_at as string | undefined) ?? null,
        status: item.status as PromoCodeStatus,
        created_by: item.created_by as string,
        created_at: item.created_at as string,
        updated_at: item.updated_at as string,
    };
}

export class PromoCodeService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('promo-code');
        this.DB_Client = DB_Client;
    }

    // Get promo code by its redemption string — PK=PROMO#CODE#{code}, SK=META → resolves uuid → metadata.
    // Case-insensitive: codes are always stored/looked-up uppercased.
    public async getPromoCodeByCode(code: string): Promise<PromoCode | null> {
        const normalized = code.trim().toUpperCase();

        const lookup = await this.DB_Client.send(
            new GetCommand({
                TableName: getTable(),
                Key: { PK: `PROMO#CODE#${normalized}`, SK: 'META' },
            }),
        );
        if (!lookup.Item) return null;

        const uuid = lookup.Item.uuid as string;
        const meta = await this.DB_Client.send(
            new GetCommand({
                TableName: getTable(),
                Key: { PK: 'PROMO', SK: `META#${uuid}` },
            }),
        );
        if (!meta.Item) return null;

        return itemToPromoCode(meta.Item);
    }
}

// Pre-check with a friendly message before attempting the transaction — the transact item's
// ConditionExpression (see buildPromoRedemptionTransactItems) is the actual race-safe enforcement,
// this just avoids a wasted TransactWriteCommand attempt in the common non-race case.
export function assertPromoCodeRedeemable(promo: PromoCode, now: Date): void {
    if (promo.status !== 'active') {
        throw new InvalidPromoCodeError(`Promo code '${promo.code}' is no longer active`);
    }
    if (promo.expires_at && new Date(promo.expires_at) <= now) {
        throw new InvalidPromoCodeError(`Promo code '${promo.code}' has expired`);
    }
    if (promo.max_redemptions !== null && promo.redemption_count >= promo.max_redemptions) {
        throw new InvalidPromoCodeError(`Promo code '${promo.code}' has reached its redemption limit`);
    }
}

// Applies the code's effect to an in-memory Subscription before it's written — a trial-extension
// code pushes out trial_end, a percentage/flat_amount code just records the discount for staff to
// apply when collecting payment externally (no automated billing engine exists yet).
export function applyPromoToSubscription(promo: PromoCode, subscription: Subscription): Subscription {
    if (promo.type === 'trial_extension_days') {
        const extendedTrialEnd = new Date(
            new Date(subscription.trial_end).getTime() + promo.value * 24 * 60 * 60 * 1000,
        ).toISOString();
        return { ...subscription, trial_end: extendedTrialEnd, promo_code: promo.code };
    }

    return {
        ...subscription,
        promo_code: promo.code,
        discount_type: promo.type,
        discount_value: promo.value,
    };
}

// The 2 extra TransactWriteCommand items needed to atomically consume a redemption alongside org
// creation: an ADD on redemption_count guarded by status/expires_at/max_redemptions (fails the
// whole transaction if the code became invalid/exhausted between the pre-check and now), plus a
// per-org redemption-lock Put that makes "one redemption per org" race-safe and doubles as an
// audit trail.
export function buildPromoRedemptionTransactItems(promo: PromoCode, organisationId: string, now: string): TransactItem[] {
    return [
        {
            Update: {
                TableName: getTable(),
                Key: { PK: 'PROMO', SK: `META#${promo.uuid}` },
                UpdateExpression: 'ADD redemption_count :one SET updated_at = :now',
                ConditionExpression:
                    '#status = :active AND (attribute_not_exists(expires_at) OR expires_at > :now) AND (attribute_not_exists(max_redemptions) OR redemption_count < max_redemptions)',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: {
                    ':one': 1,
                    ':active': 'active',
                    ':now': now,
                },
            },
        },
        {
            Put: {
                TableName: getTable(),
                Item: {
                    PK: `PROMO#${promo.uuid}`,
                    SK: `REDEMPTION#${organisationId}`,
                    organisation_id: organisationId,
                    redeemed_at: now,
                },
                ConditionExpression: 'attribute_not_exists(PK)',
            },
        },
    ];
}
