import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import type { ContactSubmission, ContactSubmissionList } from '@sale-sync/shared/src/types';

// No hardcoded fallback — see about.service.ts's getTable() for the full rationale. Unlike that one
// this also fails loudly when the variable is missing, rather than sending `undefined` to DynamoDB.
function getTable(): string {
    const table = process.env.ORGANISATION_TABLE_NAME;
    if (!table) throw new Error('ORGANISATION_TABLE_NAME environment variable is not set');
    return table;
}

const SK_PREFIX = 'CONTACT_SUBMISSION#';

// A search reads the org's submissions page by page until it has enough matches. This bounds how many
// pages one request may read, so a rare search term in a large inbox cannot run into the Lambda
// timeout; the caller gets a cursor and simply asks for more.
const MAX_QUERY_PAGES = 10;

export class SubmissionNotFoundError extends Error {
    constructor() {
        super('Submission not found');
        this.name = 'SubmissionNotFoundError';
    }
}

function isConditionalCheckFailed(error: unknown): boolean {
    return (error as { name?: string } | null)?.name === 'ConditionalCheckFailedException';
}

// The web-app's Inbox: the Contact Us form submissions visitors make on the org's website. They are
// written by mutation-api's POST /contacts (PK=ORG#{orgUuid}, SK=CONTACT_SUBMISSION#{id}) and only
// ever read, marked read and deleted here. Every method takes the org uuid and keys on it, so an
// organisation can only reach its own submissions. See backlogs/contact-form-mutation.
export class InboxService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('inbox');
        this.DB_Client = DB_Client;
    }

    private key(orgUuid: string, id: string) {
        return { PK: `ORG#${orgUuid}`, SK: `${SK_PREFIX}${id}` };
    }

    // Newest first: the id (and so the SK) starts with the ISO submit time, read in descending order.
    // `cursor` is the id of the last item of the previous page.
    //
    // `q` is a free-text search over every submitted value, done by DynamoDB as a filter on the
    // item's lowercased `search_text` attribute. A filter is applied after items are read, so a page
    // of results may take several reads of the org's partition; see MAX_QUERY_PAGES.
    public async list(
        orgUuid: string,
        options: { limit: number; cursor?: string; q?: string },
    ): Promise<ContactSubmissionList> {
        const search = options.q?.toLowerCase();
        const items: ContactSubmission[] = [];
        let startKey: Record<string, unknown> | undefined = options.cursor
            ? this.key(orgUuid, options.cursor)
            : undefined;

        for (let page = 0; page < MAX_QUERY_PAGES; page++) {
            const res = await this.DB_Client.send(
                new QueryCommand({
                    TableName: getTable(),
                    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
                    ExpressionAttributeValues: {
                        ':pk': `ORG#${orgUuid}`,
                        ':sk': SK_PREFIX,
                        ...(search && { ':q': search }),
                    },
                    ...(search && { FilterExpression: 'contains(search_text, :q)' }),
                    ScanIndexForward: false,
                    ExclusiveStartKey: startKey,
                    // Without a filter every item read is a result, so read exactly what is still
                    // needed. With one, let DynamoDB read a full page and keep what matches.
                    ...(!search && { Limit: options.limit - items.length }),
                }),
            );

            for (const item of res.Items ?? []) {
                items.push(JSON.parse(item.data as string) as ContactSubmission);
                if (items.length === options.limit) {
                    // There may be more after this one; the next request starts right after it. If
                    // there turn out to be none, that request just returns an empty page.
                    return { items, next_cursor: items[items.length - 1].id };
                }
            }

            startKey = res.LastEvaluatedKey;
            if (!startKey) return { items, next_cursor: null };
        }

        // Page budget spent before filling the page: resume from where the reads stopped.
        return { items, next_cursor: String(startKey?.SK).slice(SK_PREFIX.length) };
    }

    public async countUnread(orgUuid: string): Promise<number> {
        let count = 0;
        let startKey: Record<string, unknown> | undefined;

        do {
            const res = await this.DB_Client.send(
                new QueryCommand({
                    TableName: getTable(),
                    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
                    FilterExpression: 'is_read = :read',
                    ExpressionAttributeValues: { ':pk': `ORG#${orgUuid}`, ':sk': SK_PREFIX, ':read': false },
                    Select: 'COUNT',
                    ExclusiveStartKey: startKey,
                }),
            );
            count += res.Count ?? 0;
            startKey = res.LastEvaluatedKey;
        } while (startKey);

        return count;
    }

    // Rewrites the whole item so `data.read` and the `is_read` filter attribute can never disagree.
    // Conditional on the item still existing, so marking a just-deleted submission cannot recreate it.
    public async setRead(orgUuid: string, id: string, read: boolean): Promise<ContactSubmission> {
        const res = await this.DB_Client.send(new GetCommand({ TableName: getTable(), Key: this.key(orgUuid, id) }));
        if (!res.Item) throw new SubmissionNotFoundError();

        const updated: ContactSubmission = { ...(JSON.parse(res.Item.data as string) as ContactSubmission), read };

        try {
            await this.DB_Client.send(
                new PutCommand({
                    TableName: getTable(),
                    Item: { ...res.Item, data: JSON.stringify(updated), is_read: read },
                    ConditionExpression: 'attribute_exists(PK)',
                }),
            );
        } catch (error) {
            if (isConditionalCheckFailed(error)) throw new SubmissionNotFoundError();
            throw error;
        }

        return updated;
    }

    public async delete(orgUuid: string, id: string): Promise<void> {
        try {
            await this.DB_Client.send(
                new DeleteCommand({
                    TableName: getTable(),
                    Key: this.key(orgUuid, id),
                    ConditionExpression: 'attribute_exists(PK)',
                }),
            );
        } catch (error) {
            if (isConditionalCheckFailed(error)) throw new SubmissionNotFoundError();
            throw error;
        }
    }
}
