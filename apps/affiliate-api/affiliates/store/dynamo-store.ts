// DynamoDB store (one table per stage, AFFILIATE_TABLE_NAME; affiliate.template.yaml creates it). Single-table layout:
//   PK AFF#<userId>  SK PROFILE       the affiliate (market fixed from the application on)
//   PK AFF#<userId>  SK LINK#<id>     a referral link
//   PK AFF#<userId>  SK REF#<id>      a referral (a business that signed up through a link)
//   PK AFF#<userId>  SK PAYOUT        the payout method (bank: only the last 4 digits; the full details come with the real flow)
//   PK SLUG#<slug>   SK SLUG          reserves a link address across every affiliate (owner userId, linkId)
// Every read is strongly consistent, so a write is seen by the next read whatever Lambda instance answers.
// The two sample affiliates are written the first time one of them is requested (seedSample), so staging needs no seed step.
import { ConditionalCheckFailedException, DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { AlreadyAppliedError, SlugTakenError } from '../services/errors';
import { seed, type Affiliate, type AffLink, type PayoutMethod, type Referral } from './seed';
import type { AffiliateStore } from './types';

const pk = (userId: string) => `AFF#${userId}`;
const strip = <T extends Record<string, unknown>>(item: T) => {
    const { PK, SK, kind, ...rest } = item as Record<string, unknown>;
    void PK;
    void SK;
    void kind;
    return rest;
};
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function createDynamoStore(table: string, client?: DynamoDBDocumentClient): AffiliateStore {
    const db = client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });

    const query = async <T>(userId: string, prefix: string): Promise<T[]> => {
        const out: T[] = [];
        let start: Record<string, unknown> | undefined;
        do {
            const r = await db.send(
                new QueryCommand({
                    TableName: table,
                    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
                    ExpressionAttributeValues: { ':pk': pk(userId), ':sk': prefix },
                    ConsistentRead: true,
                    ExclusiveStartKey: start,
                }),
            );
            out.push(...((r.Items ?? []).map(strip) as T[]));
            start = r.LastEvaluatedKey;
        } while (start);
        return out;
    };

    /** Writes a sample affiliate (profile, links with their address reservations, referrals, payout method) once. */
    const seedSample = async (userId: string): Promise<Affiliate | null> => {
        const s = seed();
        const profile = s.affiliates.get(userId);
        if (!profile) return null;
        try {
            await db.send(new PutCommand({ TableName: table, Item: { PK: pk(userId), SK: 'PROFILE', kind: 'affiliate', ...profile }, ConditionExpression: 'attribute_not_exists(PK)' }));
        } catch (e) {
            if (e instanceof ConditionalCheckFailedException) return profile; // another request seeded it first
            throw e;
        }
        const items: Record<string, unknown>[] = [
            ...s.links.filter((l) => l.userId === userId).flatMap((l) => [
                { PK: pk(userId), SK: `LINK#${l.id}`, kind: 'link', ...l },
                { PK: `SLUG#${l.slug}`, SK: 'SLUG', kind: 'slug', userId, linkId: l.id },
            ]),
            ...s.referrals.filter((r) => r.userId === userId).map((r) => ({ PK: pk(userId), SK: `REF#${r.id}`, kind: 'referral', ...r })),
            { PK: pk(userId), SK: 'PAYOUT', kind: 'payout', method: s.payouts.get(userId) ?? { kind: 'none' } },
        ];
        for (let i = 0; i < items.length; i += 25) {
            await db.send(new BatchWriteCommand({ RequestItems: { [table]: items.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } })) } }));
        }
        return profile;
    };

    return {
        async getAffiliate(userId) {
            const r = await db.send(new GetCommand({ TableName: table, Key: { PK: pk(userId), SK: 'PROFILE' }, ConsistentRead: true }));
            if (r.Item) return strip(r.Item) as Affiliate;
            return seedSample(userId);
        },
        async createAffiliate(a) {
            try {
                await db.send(new PutCommand({ TableName: table, Item: { PK: pk(a.userId), SK: 'PROFILE', kind: 'affiliate', ...a }, ConditionExpression: 'attribute_not_exists(PK)' }));
            } catch (e) {
                if (e instanceof ConditionalCheckFailedException) throw new AlreadyAppliedError();
                throw e;
            }
            return a;
        },
        async putAffiliate(a) {
            await db.send(new PutCommand({ TableName: table, Item: { PK: pk(a.userId), SK: 'PROFILE', kind: 'affiliate', ...a }, ConditionExpression: 'attribute_exists(PK)' }));
            return a;
        },
        listLinks: (userId) => query<AffLink>(userId, 'LINK#'),
        async addLink(link) {
            const created: AffLink = { ...link, id: newId('link') };
            try {
                await db.send(
                    new TransactWriteCommand({
                        TransactItems: [
                            { Put: { TableName: table, Item: { PK: `SLUG#${link.slug}`, SK: 'SLUG', kind: 'slug', userId: link.userId, linkId: created.id }, ConditionExpression: 'attribute_not_exists(PK)' } },
                            { Put: { TableName: table, Item: { PK: pk(link.userId), SK: `LINK#${created.id}`, kind: 'link', ...created } } },
                        ],
                    }),
                );
            } catch (e) {
                if (e instanceof TransactionCanceledException && e.CancellationReasons?.[0]?.Code === 'ConditionalCheckFailed') throw new SlugTakenError(link.slug);
                throw e;
            }
            return created;
        },
        listReferrals: (userId) => query<Referral>(userId, 'REF#'),
        async getPayoutMethod(userId) {
            const r = await db.send(new GetCommand({ TableName: table, Key: { PK: pk(userId), SK: 'PAYOUT' }, ConsistentRead: true }));
            return ((r.Item?.method as PayoutMethod | undefined) ?? { kind: 'none' }) as PayoutMethod;
        },
        async putPayoutMethod(userId, method) {
            await db.send(new PutCommand({ TableName: table, Item: { PK: pk(userId), SK: 'PAYOUT', kind: 'payout', method } }));
            return method;
        },
    };
}
