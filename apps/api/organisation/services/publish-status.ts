import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import type { PublishStatusItem, PublishStatusKey, PublishStatusResponse } from '@sale-sync/shared/src/types';
import { computePublishStatus } from './publish-status.util';

export { computePublishStatus };

// No hardcoded fallback: staging/prod are different tables — same pattern as the page services'
// getTable(). Read lazily so tests' env var setup is picked up.
function getTable(): string {
    return process.env.ORGANISATION_TABLE_NAME as string;
}

// Module-level client, same idiom as agents-page.service.ts's module-level lambdaClient: every
// page service's publish() calls these functions, so they don't each need a client injected.
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function statusKey(orgUuid: string, page: PublishStatusKey) {
    return { PK: `ORG#${orgUuid}`, SK: `PUBLISH_STATUS#${page}` };
}

// Starts a fresh publish run for one page, overwriting any previous run's item, and returns its
// publish_id. `expected` is the list of generator names that publish() is about to invoke; each one
// reports into `results` itself (see the generators' reportResult in ss/infra). SK=PUBLISH_STATUS#{page}
// — confirmed no collision with the other SKs in this table (the singleton page records, USER#,
// AGENT#, TEMPLATE#, THEME#, ...), and none of the PK+begins_with(SK) queries use a prefix it matches.
export async function startPublish(orgUuid: string, page: PublishStatusKey, expected: string[]): Promise<string> {
    const publishId = uuidv4();
    const item: PublishStatusItem = {
        publish_id: publishId,
        page,
        expected,
        results: {},
        started_at: new Date().toISOString(),
    };

    await db.send(
        new PutCommand({
            TableName: getTable(),
            Item: { ...statusKey(orgUuid, page), ...item },
        }),
    );

    return publishId;
}

// Records that a generator's Lambda invoke itself failed, so the run shows as 'fail' instead of
// hanging as 'generating' forever. Conditional on publish_id so a stale failure can't overwrite a
// newer publish's item. Never throws: this runs inside publish()'s existing invoke catch block.
export async function markJobFailedToStart(
    orgUuid: string,
    page: PublishStatusKey,
    publishId: string | undefined,
    generator: string,
    reason: string,
): Promise<void> {
    if (!publishId) {
        return;
    }

    try {
        await db.send(
            new UpdateCommand({
                TableName: getTable(),
                Key: statusKey(orgUuid, page),
                UpdateExpression: 'SET #results.#g = :r',
                ConditionExpression: 'publish_id = :pid',
                ExpressionAttributeNames: { '#results': 'results', '#g': generator },
                ExpressionAttributeValues: {
                    ':r': { ok: false, reason, finished_at: new Date().toISOString() },
                    ':pid': publishId,
                },
            }),
        );
    } catch (error) {
        console.error(`Failed to record start failure of ${generator} for ${page}`, error);
    }
}

// Wraps startPublish for publish() call sites: a failure writing the status item must never fail the
// publish itself, so it logs and returns undefined (the generators then no-op their reportResult).
export async function tryStartPublish(
    orgUuid: string,
    page: PublishStatusKey,
    expected: string[],
): Promise<string | undefined> {
    try {
        return await startPublish(orgUuid, page, expected);
    } catch (error) {
        console.error(`Failed to start publish status tracking for ${page} — publish continues untracked`, error);
        return undefined;
    }
}

export async function getPublishStatus(orgUuid: string, page: PublishStatusKey): Promise<PublishStatusResponse> {
    const res = await db.send(
        new GetCommand({
            TableName: getTable(),
            Key: statusKey(orgUuid, page),
        }),
    );

    return computePublishStatus(page, (res.Item as PublishStatusItem | undefined) ?? null);
}

// Short human-readable reason for a generator invoke that failed to start, shown to the user via
// the status GET's `reason`.
export function startFailureReason(error: unknown): string {
    return `could not start page generation: ${error instanceof Error ? error.message : String(error)}`;
}
