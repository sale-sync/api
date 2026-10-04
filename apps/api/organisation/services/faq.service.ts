import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { Service } from '@devyethiha/samjs';
import { markJobFailedToStart, startFailureReason, tryStartPublish } from './publish-status';
import type { FaqContent, FaqEntry, FaqHero, FaqRecord, FaqTopic, SEO } from '@sale-sync/shared/src/types';

// A PATCH may update just one of these — see FaqContent's own comment (libs/shared) for why
// updateDraft() merges rather than full-replaces.
export type UpdateFaqDraftPatch = {
    topics?: FaqTopic[];
    faqs?: FaqEntry[];
    hero?: FaqHero;
    seo?: SEO;
};

// No hardcoded fallback — see about.service.ts's getTable() for the full rationale (staging/prod use
// different literal table names; a default here would mean a misconfigured staging deploy silently
// writes to the prod table instead of erroring).
function getTable(): string {
    return process.env.ORGANISATION_TABLE_NAME as string;
}

// Same fire-and-forget cross-stack invoke idiom ArticlesService/LocationsService use —
// publish-faq-page lives in ss/infra, a different SAM app/stack than this one.
const PUBLISH_FAQ_PAGE_FUNCTION_NAME = process.env.PUBLISH_FAQ_PAGE_FUNCTION_NAME;
const lambdaClient = new LambdaClient({});

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
// publish semantics (draft left equal to the just-published value, not nulled). Holds two flat,
// related top-level lists (`topics: FaqTopic[]`, `faqs: FaqEntry[]` with `topicIds` as the
// many-to-many join) — see backlogs/real-estate-template/children/faq-many-to-many-topics — plus an
// editable `hero`/`seo` (backlogs/real-estate-template/children/faq-page-hero). Topic-id and faq-id
// (now global, not per-topic) uniqueness, plus topicId referential integrity, are validated by the
// DTO (UpdateFaqDraftSchema), not here.
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

    // Field-level merge, not a full replace: `topics`/`faqs`/`hero`/`seo` are each independently
    // optional, falling back to whatever's already in the current draft when omitted from this
    // particular patch. This is what lets the Topic editor PATCH just `{ topics }`, the FAQ editor
    // PATCH just `{ faqs }` (including the topic-delete cascade, which sends both together), and the
    // Hero/SEO editor PATCH just `{ hero, seo }`, without any of them wiping out the others — same
    // shape as ArticlesService.updateDraft()'s merge.
    public async updateDraft(orgUuid: string, patch: UpdateFaqDraftPatch): Promise<FaqRecord> {
        const current = await this.get(orgUuid);

        const updatedDraft: FaqContent = {
            topics: patch.topics ?? current.draft?.topics ?? [],
            faqs: patch.faqs ?? current.draft?.faqs ?? [],
            hero: patch.hero ?? current.draft?.hero,
            seo: patch.seo ?? current.draft?.seo,
        };

        const updated: FaqRecord = {
            ...current,
            draft: updatedDraft,
            updated_at: new Date().toISOString(),
        };

        await this.put(orgUuid, updated);
        return updated;
    }

    // Flips draft -> data. Leaves `draft` equal to the just-published value (not nulled), same
    // rationale as ArticlesService.publish/LocationsService.publish. Also fire-and-forget invokes
    // infra/functions/publish-faq-page, but ONLY when `hero` or `seo` actually changed since the last
    // publish — unlike Home/Agents (one editable record, always worth re-baking), this record also
    // holds the topics/questions lists, which change far more often than the Hero and must never
    // trigger a Hero rebake on their own (same decoupling rationale as
    // ArticlesService.publish()/LocationsService.publish()). Unlike those two, there's no per-item
    // detail-page generator to also diff/invoke here — FAQ has no per-item routes.
    public async publish(orgUuid: string): Promise<FaqRecord> {
        const current = await this.get(orgUuid);
        if (!current.draft) {
            throw new NoDraftToPublishError();
        }

        // `seo` is baked by the same generator as `hero` (it patches the page's <head> tags too), so an
        // SEO-only edit must fire it as well — gating on `hero` alone left SEO-only publishes saved but
        // never baked until the Hero next changed.
        const heroOrSeoChanged =
            JSON.stringify(current.data?.hero) !== JSON.stringify(current.draft.hero) ||
            JSON.stringify(current.data?.seo) !== JSON.stringify(current.draft.seo);

        const updated: FaqRecord = {
            ...current,
            data: current.draft,
            published_at: new Date().toISOString(),
        };

        await this.put(orgUuid, updated);

        const willBakeHero = heroOrSeoChanged && !!PUBLISH_FAQ_PAGE_FUNCTION_NAME;
        const publishId = await tryStartPublish(orgUuid, 'faq', willBakeHero ? ['faq-page'] : []);

        if (willBakeHero) {
            try {
                await lambdaClient.send(
                    new InvokeCommand({
                        FunctionName: PUBLISH_FAQ_PAGE_FUNCTION_NAME,
                        InvocationType: 'Event',
                        Payload: JSON.stringify({ organisation_uuid: orgUuid, publish_id: publishId, page_key: 'faq' }),
                    }),
                );
            } catch (error) {
                console.error(
                    'Failed to invoke publish-faq-page — FAQ published, but Hero regeneration was not started',
                    error,
                );
                await markJobFailedToStart(orgUuid, 'faq', publishId, 'faq-page', startFailureReason(error));
            }
        }

        return updated;
    }
}
