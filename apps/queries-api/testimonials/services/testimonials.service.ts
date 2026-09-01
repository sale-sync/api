import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import type { TestimonialsRecord } from '@sale-sync/shared/src/types';

const TABLE = process.env.ORGANISATION_TABLE_NAME || 'sale-sync-organisation';

const EMPTY_RECORD: TestimonialsRecord = {
    data: null,
    draft: null,
    updated_at: new Date(0).toISOString(),
    published_at: null,
};

// Read-only mirror of api/organisation/services/testimonials.service.ts's get() — this stack never
// writes testimonials (see template.yaml's DynamoDBReadPolicy), so put/updateDraft/publish are
// deliberately not carried over. Callers must only ever read `.data` (published), never `.draft`.
export class TestimonialsService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('testimonials');
        this.DB_Client = DB_Client;
    }

    // Singleton per-org record — PK=ORG#{orgUuid}, SK=TESTIMONIALS
    public async get(orgUuid: string): Promise<TestimonialsRecord> {
        const res = await this.DB_Client.send(
            new GetCommand({
                TableName: TABLE,
                Key: { PK: `ORG#${orgUuid}`, SK: 'TESTIMONIALS' },
            }),
        );

        return res.Item ? (JSON.parse(res.Item.data as string) as TestimonialsRecord) : EMPTY_RECORD;
    }
}
