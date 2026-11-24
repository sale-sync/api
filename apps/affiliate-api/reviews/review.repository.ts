// Reviews domain: reads applications by stage (the ByStage index of the affiliate table, owned by ss/infra) and records a
// decision on a profile. The decision is a conditional write: only a pending application can be decided, so two reviewers
// deciding at once cannot both win.
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { doc, pk, strip, table } from '../shared/db';
import { AlreadyReviewedError } from '../shared/errors';
import type { Stage } from '../shared/rules';
import type { Affiliate } from '../shared/seed';

export const BY_STAGE = 'ByStage';

/** Applications in a stage, oldest first (so the longest waiting is reviewed first). */
export async function listByStage(stage: Stage): Promise<Affiliate[]> {
    const out: Affiliate[] = [];
    let start: Record<string, unknown> | undefined;
    do {
        const r = await doc().send(
            new QueryCommand({
                TableName: table(),
                IndexName: BY_STAGE,
                KeyConditionExpression: '#stage = :stage',
                ExpressionAttributeNames: { '#stage': 'stage' },
                ExpressionAttributeValues: { ':stage': stage },
                ExclusiveStartKey: start,
            }),
        );
        out.push(...(r.Items ?? []).map((i) => strip<Affiliate>(i)));
        start = r.LastEvaluatedKey;
    } while (start);
    return out;
}

/** Writes the decided profile, only if it is still pending. */
export async function saveDecision(a: Affiliate): Promise<Affiliate> {
    try {
        await doc().send(
            new PutCommand({
                TableName: table(),
                Item: { PK: pk(a.userId), SK: 'PROFILE', kind: 'affiliate', ...a },
                ConditionExpression: '#stage = :pending',
                ExpressionAttributeNames: { '#stage': 'stage' },
                ExpressionAttributeValues: { ':pending': 'pending' },
            }),
        );
    } catch (e) {
        if (e instanceof ConditionalCheckFailedException) throw new AlreadyReviewedError();
        throw e;
    }
    return a;
}
