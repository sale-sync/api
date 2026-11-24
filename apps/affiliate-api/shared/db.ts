// The DynamoDB side shared by the affiliate Lambdas: the client, the table, the keys. The table is owned by ss/infra
// (template.yaml, AffiliateTable, ${ResourcePrefix}sale-sync-affiliate). Each domain keeps its own reads and writes in its own
// repository; this file only holds what they all need. Single-table layout:
//   PK AFF#<userId>  SK PROFILE       the affiliate (affiliates domain)
//   PK AFF#<userId>  SK LINK#<id>     a referral link (links domain)
//   PK AFF#<userId>  SK REF#<id>      a referral (referrals domain)
//   PK AFF#<userId>  SK PAYOUT        the payout method (payouts domain)
//   PK SLUG#<slug>   SK SLUG          reserves a link address across every affiliate (links domain)
// Every read is strongly consistent, so a write is seen by the next read on any Lambda instance.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

export const pk = (userId: string) => `AFF#${userId}`;

let client: DynamoDBDocumentClient | null = null;
/** Tests put an in-memory fake here (testing/fake-ddb.ts). */
export function setDocClient(c: DynamoDBDocumentClient | null) {
    client = c;
}
export function doc(): DynamoDBDocumentClient {
    client ??= DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
    return client;
}

/** The affiliate table of this stage; required (staging and production are different tables, never fall back to one). */
export function table(): string {
    const name = process.env.AFFILIATE_TABLE_NAME;
    if (!name) throw new Error('AFFILIATE_TABLE_NAME environment variable is not set');
    return name;
}

/** Drops the key and type attributes, leaving the record. */
export function strip<T>(item: Record<string, unknown>): T {
    const { PK, SK, kind, ...rest } = item;
    void PK;
    void SK;
    void kind;
    return rest as T;
}

/** Every item of one affiliate whose sort key starts with `prefix`, all pages, strongly consistent. */
export async function queryAffiliate<T>(userId: string, prefix: string): Promise<T[]> {
    const out: T[] = [];
    let start: Record<string, unknown> | undefined;
    do {
        const r = await doc().send(
            new QueryCommand({
                TableName: table(),
                KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
                ExpressionAttributeValues: { ':pk': pk(userId), ':sk': prefix },
                ConsistentRead: true,
                ExclusiveStartKey: start,
            }),
        );
        out.push(...(r.Items ?? []).map((i) => strip<T>(i)));
        start = r.LastEvaluatedKey;
    } while (start);
    return out;
}

export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
