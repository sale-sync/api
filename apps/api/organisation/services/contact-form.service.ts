import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import { DEFAULT_CONTACT_FORM_FIELDS } from '@sale-sync/shared';
import type { ContactFormField, ContactFormRecord } from '@sale-sync/shared/src/types';

// No hardcoded fallback — see about.service.ts's getTable() for the full rationale. Unlike that one
// this also fails loudly when the variable is missing, rather than sending `undefined` to DynamoDB.
function getTable(): string {
    const table = process.env.ORGANISATION_TABLE_NAME;
    if (!table) throw new Error('ORGANISATION_TABLE_NAME environment variable is not set');
    return table;
}

// The Contact Us page's dynamic form definition: a singleton per-org record (PK=ORG#{orgUuid},
// SK=CONTACT_FORM), so every organisation has its own. Unlike ContactService (the page's
// title/subtitle/business info) there is no draft/data split and no generator to invoke: the client
// site fetches the form at CSR from mutation-api's GET /contacts, so a save is live straight away.
// See backlogs/contact-form-mutation.
export class ContactFormService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('contactform');
        this.DB_Client = DB_Client;
    }

    // An org that has never saved a form gets the default one (updated_at: null), the same fields
    // mutation-api serves its visitors until then.
    public async get(orgUuid: string): Promise<ContactFormRecord> {
        const res = await this.DB_Client.send(
            new GetCommand({
                TableName: getTable(),
                Key: { PK: `ORG#${orgUuid}`, SK: 'CONTACT_FORM' },
            }),
        );

        if (!res.Item) return { fields: DEFAULT_CONTACT_FORM_FIELDS, updated_at: null };

        return JSON.parse(res.Item.data as string) as ContactFormRecord;
    }

    // Full replace: the editor always sends the whole field list (order included).
    public async save(orgUuid: string, fields: ContactFormField[]): Promise<ContactFormRecord> {
        const record: ContactFormRecord = { fields, updated_at: new Date().toISOString() };

        await this.DB_Client.send(
            new PutCommand({
                TableName: getTable(),
                Item: { PK: `ORG#${orgUuid}`, SK: 'CONTACT_FORM', data: JSON.stringify(record) },
            }),
        );

        return record;
    }
}
