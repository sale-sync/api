// Payouts domain: the payout method record (PK AFF#<userId>, SK PAYOUT). Bank details: only the last 4 digits for now; the full
// details come with the real payout flow and must be stored protected. Earnings read the referral records (referrals domain)
// and the link records (links domain) read-only.
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { doc, pk, queryAffiliate, table } from '../shared/db';
import type { AffLink, PayoutMethod, Referral } from '../shared/seed';

export async function getMethod(userId: string): Promise<PayoutMethod> {
    const r = await doc().send(new GetCommand({ TableName: table(), Key: { PK: pk(userId), SK: 'PAYOUT' }, ConsistentRead: true }));
    return ((r.Item?.method as PayoutMethod | undefined) ?? { kind: 'none' }) as PayoutMethod;
}
export async function putMethod(userId: string, method: PayoutMethod): Promise<PayoutMethod> {
    await doc().send(new PutCommand({ TableName: table(), Item: { PK: pk(userId), SK: 'PAYOUT', kind: 'payout', method } }));
    return method;
}
/** read-only, the subscriptions that earned */
export const listReferralsForEarnings = (userId: string) => queryAffiliate<Referral>(userId, 'REF#');
/** read-only, the channel of each subscription's link */
export const listLinksForChannels = (userId: string) => queryAffiliate<AffLink>(userId, 'LINK#');
