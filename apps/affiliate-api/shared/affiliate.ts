// "Who is calling, and are they an affiliate?" Every domain needs the signed-in user and their affiliate profile (market,
// stage); only the affiliates domain writes profiles. The sign-in is samjs's cookie check until the Cognito pool exists.
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUser, isAuthorize, NO_USER, UNAUTHORIZE_ERROR } from '@devyethiha/samjs';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { doc, pk, strip, table } from './db';
import { NotAnAffiliateError, NotApprovedError } from './errors';
import { seed, type Affiliate } from './seed';

/** The signed-in user, or the response to send (401 without the cookies, 404 without a user id). */
export function signedInUser(event: APIGatewayProxyEvent): { id: string; email: string } | APIGatewayProxyResult {
    if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;
    const user = getUser(event);
    if (!user?.id) return NO_USER;
    return { id: user.id, email: user.email };
}
export const isResponse = (x: unknown): x is APIGatewayProxyResult => !!x && typeof x === 'object' && 'statusCode' in x;

/** The affiliate profile, or null. `seedSamples`: write a sample affiliate on first use (only the affiliates Lambda may). */
export async function findAffiliate(userId: string, { seedSamples = false } = {}): Promise<Affiliate | null> {
    const r = await doc().send(new GetCommand({ TableName: table(), Key: { PK: pk(userId), SK: 'PROFILE' }, ConsistentRead: true }));
    if (r.Item) return strip<Affiliate>(r.Item);
    return seedSamples ? seedSample(userId) : null;
}
export async function requireAffiliate(userId: string): Promise<Affiliate> {
    const a = await findAffiliate(userId);
    if (!a) throw new NotAnAffiliateError();
    return a;
}
export async function requireApproved(userId: string): Promise<Affiliate> {
    const a = await requireAffiliate(userId);
    if (a.stage !== 'approved') throw new NotApprovedError();
    return a;
}

/** Writes a sample affiliate (profile, links with their address reservations, referrals, payout method) once. */
async function seedSample(userId: string): Promise<Affiliate | null> {
    const s = seed();
    const profile = s.affiliates.get(userId);
    if (!profile) return null;
    try {
        await doc().send(new PutCommand({ TableName: table(), Item: { PK: pk(userId), SK: 'PROFILE', kind: 'affiliate', ...profile }, ConditionExpression: 'attribute_not_exists(PK)' }));
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
        await doc().send(new BatchWriteCommand({ RequestItems: { [table()]: items.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } })) } }));
    }
    return profile;
}
