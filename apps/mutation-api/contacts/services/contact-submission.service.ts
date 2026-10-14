import { randomUUID } from 'crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import type { ContactSubmission, ContactSubmissionValue } from '@sale-sync/shared/src/types';
import { getTable } from './table';

// Write-only here: submissions are listed, marked read and deleted through
// api/apps/api/organisation's /organisations/inbox (web-app), never through this stack.
export class ContactSubmissionService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('contactsubmission');
        this.DB_Client = DB_Client;
    }

    // One item per submit: PK=ORG#{orgUuid}, SK=CONTACT_SUBMISSION#{id}, where id starts with the ISO
    // submit time so the org's submissions sort by time (the Inbox reads them newest first).
    //
    // Next to `data` (the record, same JSON-string convention as every other item in this table) the
    // item carries two plain attributes the Inbox filters on server-side, since DynamoDB can't look
    // inside the JSON string: `is_read` (unread count / read filter) and `search_text` (the values,
    // lowercased, for free-text search).
    public async create(orgUuid: string, values: ContactSubmissionValue[]): Promise<ContactSubmission> {
        const submittedAt = new Date().toISOString();
        const submission: ContactSubmission = {
            id: `${submittedAt}_${randomUUID()}`,
            org_uuid: orgUuid,
            submitted_at: submittedAt,
            read: false,
            values,
        };

        await this.DB_Client.send(
            new PutCommand({
                TableName: getTable(),
                Item: {
                    PK: `ORG#${orgUuid}`,
                    SK: `CONTACT_SUBMISSION#${submission.id}`,
                    data: JSON.stringify(submission),
                    is_read: false,
                    search_text: values
                        .map((entry) => entry.value)
                        .join(' ')
                        .toLowerCase(),
                },
                // The id is random, so this never trips in practice; it is here so a submit can only
                // ever add an item, never replace one.
                ConditionExpression: 'attribute_not_exists(PK)',
            }),
        );

        return submission;
    }
}
