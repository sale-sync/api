import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import type { ArticlesRecord } from '@sale-sync/shared/src/types';

// No hardcoded fallback: staging and prod use different literal table names — see
// api/apps/api/organisation/services/organisation.service.ts's getTable() for the full rationale.
// ORGANISATION_TABLE_NAME is always set via queries.template.yaml's Globals, so this only ever fails
// loud in a genuinely misconfigured deploy rather than silently reading the wrong table.
function getTable(): string {
    return process.env.ORGANISATION_TABLE_NAME as string;
}

const EMPTY_RECORD: ArticlesRecord = {
    data: null,
    draft: null,
    updated_at: new Date(0).toISOString(),
    published_at: null,
};

// Read-only, same `data`/`draft` singleton shape as LocationsService (see
// api/apps/api/organisation/services/locations.service.ts) — this stack never writes articles
// content (see queries.template.yaml's DynamoDBReadPolicy); writes go through
// api/apps/api/organisation/articles/. Callers must only ever read `.data` (published), never
// `.draft`.
export class ArticlesService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('articles');
        this.DB_Client = DB_Client;
    }

    // Singleton per-org record — PK=ORG#{orgUuid}, SK=ARTICLES
    public async get(orgUuid: string): Promise<ArticlesRecord> {
        const res = await this.DB_Client.send(
            new GetCommand({
                TableName: getTable(),
                Key: { PK: `ORG#${orgUuid}`, SK: 'ARTICLES' },
            }),
        );

        if (!res.Item) return EMPTY_RECORD;

        return JSON.parse(res.Item.data as string) as ArticlesRecord;
    }
}
