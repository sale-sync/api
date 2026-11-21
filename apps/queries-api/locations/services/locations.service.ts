import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import type { LocationsRecord } from '@sale-sync/shared/src/types';
import { normalizeLocationsContent } from '@sale-sync/shared';

// No hardcoded fallback: staging and prod use different literal table names — see
// api/apps/api/organisation/services/organisation.service.ts's getTable() for the full rationale.
// ORGANISATION_TABLE_NAME is always set via queries.template.yaml's Globals, so this only ever fails
// loud in a genuinely misconfigured deploy rather than silently reading the wrong table.
function getTable(): string {
    return process.env.ORGANISATION_TABLE_NAME as string;
}

const EMPTY_RECORD: LocationsRecord = {
    data: null,
    draft: null,
    updated_at: new Date(0).toISOString(),
    published_at: null,
};

// Read-only, same `data`/`draft` singleton shape as AboutService/TestimonialsService (see
// api/apps/api/organisation/services/about.service.ts) — this stack never writes locations content
// (see template.yaml's DynamoDBReadPolicy); writes go through api/apps/api/organisation/locations/.
// Callers must only ever read `.data` (published), never `.draft`.
export class LocationsService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('locations');
        this.DB_Client = DB_Client;
    }

    // Singleton per-org record — PK=ORG#{orgUuid}, SK=LOCATIONS
    public async get(orgUuid: string): Promise<LocationsRecord> {
        const res = await this.DB_Client.send(
            new GetCommand({
                TableName: getTable(),
                Key: { PK: `ORG#${orgUuid}`, SK: 'LOCATIONS' },
            }),
        );

        if (!res.Item) return EMPTY_RECORD;

        const record = JSON.parse(res.Item.data as string) as LocationsRecord;
        // Backward-compat for records published before the propertyCount -> label rename — see
        // normalizeLocationsContent's own comment. Without this, an old published record would
        // serve `label: undefined` to the client site (see actions/location-grid.ts).
        return { ...record, data: normalizeLocationsContent(record.data) };
    }
}
