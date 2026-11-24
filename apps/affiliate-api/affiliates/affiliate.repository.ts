// Affiliates domain: the affiliate profile records (PK AFF#<userId>, SK PROFILE). Reading a profile is shared (shared/affiliate.ts);
// writing one happens only here.
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { doc, pk, table } from '../shared/db';
import { AlreadyAppliedError } from '../shared/errors';
import type { Affiliate } from '../shared/seed';

/** The first write of an affiliate: the application. One per user, enforced by the table (two requests at once cannot both apply). */
export async function createProfile(a: Affiliate): Promise<Affiliate> {
    try {
        await doc().send(new PutCommand({ TableName: table(), Item: { PK: pk(a.userId), SK: 'PROFILE', kind: 'affiliate', ...a }, ConditionExpression: 'attribute_not_exists(PK)' }));
    } catch (e) {
        if (e instanceof ConditionalCheckFailedException) throw new AlreadyAppliedError();
        throw e;
    }
    return a;
}

/** Profile changes of an existing affiliate. */
export async function updateProfile(a: Affiliate): Promise<Affiliate> {
    await doc().send(new PutCommand({ TableName: table(), Item: { PK: pk(a.userId), SK: 'PROFILE', kind: 'affiliate', ...a }, ConditionExpression: 'attribute_exists(PK)' }));
    return a;
}
