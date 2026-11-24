// Clicks domain: the address reservation (PK SLUG#<slug>, written by the links domain) says whose link it is; a click adds 1
// to that link's clicks (PK AFF#<userId>, SK LINK#<id>) in one atomic update. Read the reservation, write only the counter.
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { doc, pk, table } from '../shared/db';

export type SlugOwner = { userId: string; linkId: string };

export async function findSlug(slug: string): Promise<SlugOwner | null> {
    const r = await doc().send(new GetCommand({ TableName: table(), Key: { PK: `SLUG#${slug}`, SK: 'SLUG' } }));
    const it = r.Item as { userId?: string; linkId?: string } | undefined;
    return it?.userId && it.linkId ? { userId: it.userId, linkId: it.linkId } : null;
}

/** +1 on the link's clicks; only on a link that exists (never creates a stray item). */
export async function addClick(owner: SlugOwner): Promise<void> {
    await doc().send(
        new UpdateCommand({
            TableName: table(),
            Key: { PK: pk(owner.userId), SK: `LINK#${owner.linkId}` },
            UpdateExpression: 'ADD clicks :one',
            ConditionExpression: 'attribute_exists(PK)',
            ExpressionAttributeValues: { ':one': 1 },
        }),
    );
}
