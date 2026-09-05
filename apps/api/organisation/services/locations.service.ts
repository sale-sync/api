import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import type { LocationItem, LocationsContent, LocationsRecord } from '@sale-sync/shared/src/types';
import { normalizeLocationsContent } from '@sale-sync/shared';

// No hardcoded fallback — see about.service.ts's getTable() for the full rationale (staging/prod use
// different literal table names; a default here would mean a misconfigured staging deploy silently
// writes to the prod table instead of erroring).
function getTable(): string {
    return process.env.ORGANISATION_TABLE_NAME as string;
}

const EMPTY_RECORD: LocationsRecord = {
    data: null,
    draft: null,
    updated_at: new Date(0).toISOString(),
    published_at: null,
};

export class NoDraftToPublishError extends Error {
    constructor() {
        super('No draft locations changes to publish');
        this.name = 'NoDraftToPublishError';
    }
}

// Mirrors AboutService exactly — singleton per-org record, data/draft split, same publish semantics
// (draft left equal to the just-published value, not nulled). Unlike About, the record holds a list
// (`locations: LocationItem[]`) rather than one document — slug-uniqueness across that list is
// validated by the DTO (UpdateLocationsDraftSchema), not here.
export class LocationsService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('locations');
        this.DB_Client = DB_Client;
    }

    // Singleton per-org record — PK=ORG#{orgUuid}, SK=LOCATIONS.
    public async get(orgUuid: string): Promise<LocationsRecord> {
        const res = await this.DB_Client.send(
            new GetCommand({
                TableName: getTable(),
                Key: { PK: `ORG#${orgUuid}`, SK: 'LOCATIONS' },
            }),
        );

        if (!res.Item) return EMPTY_RECORD;

        const record = JSON.parse(res.Item.data as string) as LocationsRecord;
        // Backward-compat for records saved before the propertyCount -> label rename — see
        // normalizeLocationsContent's own comment. Applied on every read so an old, unmigrated
        // record doesn't fail UpdateLocationsDraftSchema's validation the next time any one
        // location in it is saved (saving resubmits the whole array).
        return {
            ...record,
            data: normalizeLocationsContent(record.data),
            draft: normalizeLocationsContent(record.draft),
        };
    }

    private async put(orgUuid: string, record: LocationsRecord): Promise<void> {
        await this.DB_Client.send(
            new PutCommand({
                TableName: getTable(),
                Item: { PK: `ORG#${orgUuid}`, SK: 'LOCATIONS', data: JSON.stringify(record) },
            }),
        );
    }

    // Full replace, not a merge — the web-app editor always submits the complete list on save (same
    // contract as AboutService.updateDraft's full-document replace), so there's no partial-field
    // patch semantics to reconcile like TestimonialsService.updateDraft has.
    public async updateDraft(orgUuid: string, locations: LocationItem[]): Promise<LocationsRecord> {
        const current = await this.get(orgUuid);
        const updatedDraft: LocationsContent = { locations };

        const updated: LocationsRecord = {
            ...current,
            draft: updatedDraft,
            updated_at: new Date().toISOString(),
        };

        await this.put(orgUuid, updated);
        return updated;
    }

    // Flips draft -> data. Leaves `draft` equal to the just-published value (not nulled), same
    // rationale as AboutService.publish/TestimonialsService.publish.
    public async publish(orgUuid: string): Promise<LocationsRecord> {
        const current = await this.get(orgUuid);
        if (!current.draft) {
            throw new NoDraftToPublishError();
        }

        const updated: LocationsRecord = {
            ...current,
            data: current.draft,
            published_at: new Date().toISOString(),
        };

        await this.put(orgUuid, updated);
        return updated;
    }
}
