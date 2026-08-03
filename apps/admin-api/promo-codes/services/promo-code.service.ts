import { DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import type { PromoCode, PromoCodeStatus, PromoCodeType } from '@sale-sync/shared/src/types';
import { v4 as uuidv4 } from 'uuid';

const TABLE = 'sale-sync-organisation';

type CreatePromoCodeParam = {
    code: string;
    type: PromoCodeType;
    value: number;
    max_redemptions?: number | null;
    expires_at?: string | null;
    created_by: string;
};

type UpdatePromoCodeParam = {
    uuid: string;
    status?: PromoCodeStatus;
    max_redemptions?: number | null;
    expires_at?: string | null;
};

export class PromoCodeAlreadyExistsError extends Error {
    constructor(code: string) {
        super(`Promo code '${code}' already exists`);
        this.name = 'PromoCodeAlreadyExistsError';
    }
}

export class PromoCodeRedeemedError extends Error {
    constructor(code: string) {
        super(`Promo code '${code}' has already been redeemed and cannot be deleted — disable it instead`);
        this.name = 'PromoCodeRedeemedError';
    }
}

// PromoCode is stored as flat top-level attributes (not a JSON `data` blob like Plan/Subscription)
// — redemption (api/apps/api/organisation's promo-code.service.ts) needs a native atomic ADD on
// redemption_count plus a ConditionExpression guarding status/expires_at/max_redemptions, which a
// blob can't support. max_redemptions/expires_at are OMITTED from the item entirely when null
// (unlimited/never-expires), not stored as DynamoDB NULL — attribute_not_exists() checks rely on
// that, see createPromoCode below.
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

    // List all promo codes — PK=PROMO, SK begins_with META#
    public async listPromoCodes(): Promise<PromoCode[]> {
        const res = await this.DB_Client.send(
            new QueryCommand({
                TableName: TABLE,
                KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
                ExpressionAttributeValues: { ':pk': 'PROMO', ':prefix': 'META#' },
            }),
        );

        return (res.Items ?? []).map(itemToPromoCode);
    }

    // Get promo code by UUID — PK=PROMO, SK=META#{uuid}
    public async getPromoCodeByUuid(uuid: string): Promise<PromoCode | null> {
        const res = await this.DB_Client.send(new GetCommand({ TableName: TABLE, Key: { PK: 'PROMO', SK: `META#${uuid}` } }));
        return res.Item ? itemToPromoCode(res.Item) : null;
    }

    // Get promo code by its redemption string — PK=PROMO#CODE#{code}, SK=META → resolves uuid
    public async getPromoCodeByCode(code: string): Promise<PromoCode | null> {
        const normalized = code.trim().toUpperCase();
        const lookup = await this.DB_Client.send(
            new GetCommand({ TableName: TABLE, Key: { PK: `PROMO#CODE#${normalized}`, SK: 'META' } }),
        );
        if (!lookup.Item) return null;
        return this.getPromoCodeByUuid(lookup.Item.uuid as string);
    }

    // Create promo code — TransactWrite both items, conditional to reject duplicate codes
    public async createPromoCode(param: CreatePromoCodeParam): Promise<PromoCode> {
        const uuid = uuidv4();
        const now = new Date().toISOString();
        const code = param.code.trim().toUpperCase();
        const maxRedemptions = param.max_redemptions ?? null;
        const expiresAt = param.expires_at ?? null;

        const promo: PromoCode = {
            uuid,
            code,
            type: param.type,
            value: param.value,
            max_redemptions: maxRedemptions,
            redemption_count: 0,
            expires_at: expiresAt,
            status: 'active',
            created_by: param.created_by,
            created_at: now,
            updated_at: now,
        };

        const metaItem: Record<string, unknown> = {
            PK: 'PROMO',
            SK: `META#${uuid}`,
            uuid,
            code,
            type: param.type,
            value: param.value,
            redemption_count: 0,
            status: 'active',
            created_by: param.created_by,
            created_at: now,
            updated_at: now,
        };
        if (maxRedemptions !== null) metaItem.max_redemptions = maxRedemptions;
        if (expiresAt !== null) metaItem.expires_at = expiresAt;

        try {
            await this.DB_Client.send(
                new TransactWriteCommand({
                    TransactItems: [
                        {
                            Put: {
                                TableName: TABLE,
                                Item: metaItem,
                                ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
                            },
                        },
                        // Code uniqueness / code→uuid lookup — PK=PROMO#CODE#${code}, SK=META
                        {
                            Put: {
                                TableName: TABLE,
                                Item: { PK: `PROMO#CODE#${code}`, SK: 'META', uuid },
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
                throw new PromoCodeAlreadyExistsError(code);
            }
            throw error;
        }

        return promo;
    }

    // Update promo code — only status/max_redemptions/expires_at are patchable (not code/type/value
    // — changing the deal after the fact would retroactively confuse anyone already told about it).
    // null on max_redemptions/expires_at removes the attribute entirely (see itemToPromoCode note).
    public async updatePromoCode(param: UpdatePromoCodeParam): Promise<PromoCode | null> {
        const existing = await this.getPromoCodeByUuid(param.uuid);
        if (!existing) return null;

        const names: Record<string, string> = {};
        const values: Record<string, unknown> = { ':updated_at': new Date().toISOString() };
        const setClauses: string[] = ['updated_at = :updated_at'];
        const removeClauses: string[] = [];

        if (param.status !== undefined) {
            names['#status'] = 'status';
            values[':status'] = param.status;
            setClauses.push('#status = :status');
        }
        if (param.max_redemptions !== undefined) {
            if (param.max_redemptions === null) {
                removeClauses.push('max_redemptions');
            } else {
                values[':max_redemptions'] = param.max_redemptions;
                setClauses.push('max_redemptions = :max_redemptions');
            }
        }
        if (param.expires_at !== undefined) {
            if (param.expires_at === null) {
                removeClauses.push('expires_at');
            } else {
                values[':expires_at'] = param.expires_at;
                setClauses.push('expires_at = :expires_at');
            }
        }

        let updateExpression = `SET ${setClauses.join(', ')}`;
        if (removeClauses.length > 0) {
            updateExpression += ` REMOVE ${removeClauses.join(', ')}`;
        }

        await this.DB_Client.send(
            new UpdateCommand({
                TableName: TABLE,
                Key: { PK: 'PROMO', SK: `META#${param.uuid}` },
                UpdateExpression: updateExpression,
                ExpressionAttributeNames: Object.keys(names).length > 0 ? names : undefined,
                ExpressionAttributeValues: values,
                ConditionExpression: 'attribute_exists(PK)',
            }),
        );

        return this.getPromoCodeByUuid(param.uuid);
    }

    // Delete promo code — only allowed if never redeemed (redemption_count === 0); otherwise reject
    // so staff disable it instead, preserving the audit trail of what a redeeming org actually saw.
    public async deletePromoCode(uuid: string): Promise<boolean> {
        const existing = await this.getPromoCodeByUuid(uuid);
        if (!existing) return false;

        if (existing.redemption_count > 0) {
            throw new PromoCodeRedeemedError(existing.code);
        }

        await this.DB_Client.send(
            new TransactWriteCommand({
                TransactItems: [
                    { Delete: { TableName: TABLE, Key: { PK: 'PROMO', SK: `META#${uuid}` } } },
                    { Delete: { TableName: TABLE, Key: { PK: `PROMO#CODE#${existing.code}`, SK: 'META' } } },
                ],
            }),
        );

        return true;
    }
}
