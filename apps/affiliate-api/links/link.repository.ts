// Links domain: the link records (PK AFF#<userId>, SK LINK#<id>) and the address reservations (PK SLUG#<slug>). Link results
// read the referral records (referrals domain) read-only: a referral carries the link it came through.
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { doc, newId, pk, queryAffiliate, table } from '../shared/db';
import { SlugTakenError } from '../shared/errors';
import type { AffLink, Referral } from '../shared/seed';

export const listLinks = (userId: string) => queryAffiliate<AffLink>(userId, 'LINK#');
/** read-only, for the results of each link */
export const listReferralsForStats = (userId: string) => queryAffiliate<Referral>(userId, 'REF#');

/** Adds a link and reserves its address across every affiliate in one transaction; SlugTakenError when the address is used. */
export async function addLink(link: Omit<AffLink, 'id'>): Promise<AffLink> {
    const created: AffLink = { ...link, id: newId('link') };
    try {
        await doc().send(
            new TransactWriteCommand({
                TransactItems: [
                    { Put: { TableName: table(), Item: { PK: `SLUG#${link.slug}`, SK: 'SLUG', kind: 'slug', userId: link.userId, linkId: created.id }, ConditionExpression: 'attribute_not_exists(PK)' } },
                    { Put: { TableName: table(), Item: { PK: pk(link.userId), SK: `LINK#${created.id}`, kind: 'link', ...created } } },
                ],
            }),
        );
    } catch (e) {
        if (e instanceof TransactionCanceledException && e.CancellationReasons?.[0]?.Code === 'ConditionalCheckFailed') throw new SlugTakenError(link.slug);
        throw e;
    }
    return created;
}
