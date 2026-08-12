import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import type { BrandingRecord } from '@sale-sync/shared/src/types';

const TABLE = process.env.ORGANISATION_TABLE_NAME || 'sale-sync-organisation';

const EMPTY_RECORD: BrandingRecord = {
    data: null,
    draft: null,
    updated_at: new Date(0).toISOString(),
    published_at: null,
};

// Read-only mirror of api/organisation/services/branding.service.ts's get() — this stack never
// writes branding (see template.yaml's DynamoDBReadPolicy), so put/updateDraft/publish are
// deliberately not carried over. Callers must only ever read `.data` (published), never `.draft`.
export class BrandingService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('branding');
        this.DB_Client = DB_Client;
    }

    // Singleton per-org record — PK=ORG#{orgUuid}, SK=BRANDING
    public async get(orgUuid: string): Promise<BrandingRecord> {
        const res = await this.DB_Client.send(
            new GetCommand({
                TableName: TABLE,
                Key: { PK: `ORG#${orgUuid}`, SK: 'BRANDING' },
            }),
        );

        return res.Item ? (JSON.parse(res.Item.data as string) as BrandingRecord) : EMPTY_RECORD;
    }
}
