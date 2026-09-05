import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import type { FaqContent, FaqRecord, FaqTopic } from '@sale-sync/shared/src/types';

// No hardcoded fallback — see about.service.ts's getTable() for the full rationale (staging/prod use
// different literal table names; a default here would mean a misconfigured staging deploy silently
// writes to the prod table instead of erroring).
function getTable(): string {
    return process.env.ORGANISATION_TABLE_NAME as string;
}

const EMPTY_RECORD: FaqRecord = {
    data: null,
    draft: null,
    updated_at: new Date(0).toISOString(),
    published_at: null,
};

export class NoDraftToPublishError extends Error {
    constructor() {
        super('No draft FAQ changes to publish');
        this.name = 'NoDraftToPublishError';
    }
}

// Mirrors ArticlesService/LocationsService — singleton per-org record, data/draft split, same
// publish semantics (draft left equal to the just-published value, not nulled). Holds a **nested**
// list (`topics: FaqTopic[]`, each carrying its own `faqs: FaqEntry[]`) rather than a flat one —
// topic-id and per-topic FAQ-id uniqueness are validated by the DTO (UpdateFaqDraftSchema), not here.
export class FaqService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('faq');
        this.DB_Client = DB_Client;
    }

    // Singleton per-org record — PK=ORG#{orgUuid}, SK=FAQ.
    public async get(orgUuid: string): Promise<FaqRecord> {
        const res = await this.DB_Client.send(
            new GetCommand({
                TableName: getTable(),
                Key: { PK: `ORG#${orgUuid}`, SK: 'FAQ' },
            }),
        );

        if (!res.Item) return EMPTY_RECORD;

        return JSON.parse(res.Item.data as string) as FaqRecord;
    }

    private async put(orgUuid: string, record: FaqRecord): Promise<void> {
        await this.DB_Client.send(
            new PutCommand({
                TableName: getTable(),
                Item: { PK: `ORG#${orgUuid}`, SK: 'FAQ', data: JSON.stringify(record) },
            }),
        );
    }

    // Full replace, not a merge — the web-app editor always submits the complete topics list
    // (each with its full faqs list) on save, same contract as ArticlesService.updateDraft.
    public async updateDraft(orgUuid: string, topics: FaqTopic[]): Promise<FaqRecord> {
        const current = await this.get(orgUuid);
        const updatedDraft: FaqContent = { topics };

        const updated: FaqRecord = {
            ...current,
            draft: updatedDraft,
            updated_at: new Date().toISOString(),
        };

        await this.put(orgUuid, updated);
        return updated;
    }

    // Flips draft -> data. Leaves `draft` equal to the just-published value (not nulled), same
    // rationale as ArticlesService.publish/LocationsService.publish.
    public async publish(orgUuid: string): Promise<FaqRecord> {
        const current = await this.get(orgUuid);
        if (!current.draft) {
            throw new NoDraftToPublishError();
        }

        const updated: FaqRecord = {
            ...current,
            data: current.draft,
            published_at: new Date().toISOString(),
        };

        await this.put(orgUuid, updated);
        return updated;
    }
}
