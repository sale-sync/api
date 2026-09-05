import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import type { ArticleItem, ArticlesContent, ArticlesRecord } from '@sale-sync/shared/src/types';

// No hardcoded fallback — see about.service.ts's getTable() for the full rationale (staging/prod use
// different literal table names; a default here would mean a misconfigured staging deploy silently
// writes to the prod table instead of erroring).
function getTable(): string {
    return process.env.ORGANISATION_TABLE_NAME as string;
}

const EMPTY_RECORD: ArticlesRecord = {
    data: null,
    draft: null,
    updated_at: new Date(0).toISOString(),
    published_at: null,
};

export class NoDraftToPublishError extends Error {
    constructor() {
        super('No draft articles changes to publish');
        this.name = 'NoDraftToPublishError';
    }
}

// Mirrors LocationsService exactly — singleton per-org record, data/draft split, same publish
// semantics (draft left equal to the just-published value, not nulled). Holds a list
// (`articles: ArticleItem[]`) rather than one document — slug-uniqueness across that list is
// validated by the DTO (UpdateArticlesDraftSchema), not here.
export class ArticlesService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('articles');
        this.DB_Client = DB_Client;
    }

    // Singleton per-org record — PK=ORG#{orgUuid}, SK=ARTICLES.
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

    private async put(orgUuid: string, record: ArticlesRecord): Promise<void> {
        await this.DB_Client.send(
            new PutCommand({
                TableName: getTable(),
                Item: { PK: `ORG#${orgUuid}`, SK: 'ARTICLES', data: JSON.stringify(record) },
            }),
        );
    }

    // Full replace, not a merge — the web-app editor always submits the complete list on save (same
    // contract as LocationsService.updateDraft's full-array replace).
    public async updateDraft(orgUuid: string, articles: ArticleItem[]): Promise<ArticlesRecord> {
        const current = await this.get(orgUuid);
        const updatedDraft: ArticlesContent = { articles };

        const updated: ArticlesRecord = {
            ...current,
            draft: updatedDraft,
            updated_at: new Date().toISOString(),
        };

        await this.put(orgUuid, updated);
        return updated;
    }

    // Flips draft -> data. Leaves `draft` equal to the just-published value (not nulled), same
    // rationale as LocationsService.publish/AboutService.publish.
    public async publish(orgUuid: string): Promise<ArticlesRecord> {
        const current = await this.get(orgUuid);
        if (!current.draft) {
            throw new NoDraftToPublishError();
        }

        const updated: ArticlesRecord = {
            ...current,
            data: current.draft,
            published_at: new Date().toISOString(),
        };

        await this.put(orgUuid, updated);
        return updated;
    }
}
