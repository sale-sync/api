import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import { DEFAULT_CONTACT_FORM_FIELDS } from '@sale-sync/shared';
import type { ContactFormField, ContactFormRecord } from '@sale-sync/shared/src/types';
import { getTable } from './table';

// Read-only here: an organisation edits its form through api/apps/api/organisation's
// /organisations/contact-form (web-app), never through this stack.
export class ContactFormService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('contactform');
        this.DB_Client = DB_Client;
    }

    // Singleton per-org record, PK=ORG#{orgUuid}, SK=CONTACT_FORM. Live on save, so there is no
    // draft/published split to pick from. An org that has never saved a form gets the default one.
    public async getFields(orgUuid: string): Promise<ContactFormField[]> {
        const res = await this.DB_Client.send(
            new GetCommand({
                TableName: getTable(),
                Key: { PK: `ORG#${orgUuid}`, SK: 'CONTACT_FORM' },
            }),
        );

        if (!res.Item) return DEFAULT_CONTACT_FORM_FIELDS;

        const record = JSON.parse(res.Item.data as string) as ContactFormRecord;
        return record.fields?.length ? record.fields : DEFAULT_CONTACT_FORM_FIELDS;
    }
}
