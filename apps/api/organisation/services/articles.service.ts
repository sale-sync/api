import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { Service } from '@devyethiha/samjs';
import { markJobFailedToStart, startFailureReason, tryStartPublish } from './publish-status';
import type { ArticleItem, ArticlesContent, ArticlesHero, ArticlesRecord, SEO } from '@sale-sync/shared/src/types';

// A PATCH may update just one of these — see ArticlesContent's own comment (libs/shared) for why
// updateDraft() merges rather than full-replaces.
export type UpdateArticlesDraftPatch = {
    articles?: ArticleItem[];
    hero?: ArticlesHero;
    seo?: SEO;
};

// No hardcoded fallback — see about.service.ts's getTable() for the full rationale (staging/prod use
// different literal table names; a default here would mean a misconfigured staging deploy silently
// writes to the prod table instead of erroring).
function getTable(): string {
    return process.env.ORGANISATION_TABLE_NAME as string;
}

// Same fire-and-forget cross-stack invoke idiom HomeService/AgentsPageService use —
// publish-article-listing-page/publish-article-detail-page live in ss/infra, a different SAM
// app/stack than this one.
const PUBLISH_ARTICLE_LISTING_PAGE_FUNCTION_NAME = process.env.PUBLISH_ARTICLE_LISTING_PAGE_FUNCTION_NAME;
const PUBLISH_ARTICLE_DETAIL_PAGE_FUNCTION_NAME = process.env.PUBLISH_ARTICLE_DETAIL_PAGE_FUNCTION_NAME;
const lambdaClient = new LambdaClient({});

// Slug-based diff between the previously-published article list and the one about to be published —
// publish-article-detail-page is invoked with only what actually changed, never the whole list (see
// backlogs/real-estate-template/children/articles-page-ssr-split/plan.md's whole rationale: adding
// one article shouldn't regenerate every other article's page). Deep-equal by JSON.stringify since
// ArticleItem's field order is stable (always constructed the same way, by the zod-validated DTO
// parse or by re-spreading an already-parsed item — see ArticleForm.tsx's web-app callsite).
function diffArticleSlugs(
    oldArticles: ArticleItem[],
    newArticles: ArticleItem[],
): { addedOrChanged: string[]; removed: string[] } {
    const oldBySlug = new Map(oldArticles.map((article) => [article.slug, article]));
    const newBySlug = new Map(newArticles.map((article) => [article.slug, article]));

    const addedOrChanged: string[] = [];
    for (const [slug, article] of newBySlug) {
        const previous = oldBySlug.get(slug);
        if (!previous || JSON.stringify(previous) !== JSON.stringify(article)) {
            addedOrChanged.push(slug);
        }
    }

    const removed: string[] = [];
    for (const slug of oldBySlug.keys()) {
        if (!newBySlug.has(slug)) {
            removed.push(slug);
        }
    }

    return { addedOrChanged, removed };
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

    // Field-level merge, not a full replace: `articles` still has the same full-array-replace
    // contract it always has (LocationsService's convention) when present, but `hero`/`seo` fall
    // back to whatever's already in the current draft when omitted from this particular patch. This
    // is what lets ArticleForm.tsx (web-app) keep PATCHing just `{ articles }` on every single-article
    // save without wiping out a separately-saved Hero/SEO — and lets a Hero-only editor PATCH just
    // `{ hero, seo }` without needing to resend the whole article list.
    public async updateDraft(orgUuid: string, patch: UpdateArticlesDraftPatch): Promise<ArticlesRecord> {
        const current = await this.get(orgUuid);

        const updatedDraft: ArticlesContent = {
            articles: patch.articles ?? current.draft?.articles ?? [],
            hero: patch.hero ?? current.draft?.hero,
            seo: patch.seo ?? current.draft?.seo,
        };

        const updated: ArticlesRecord = {
            ...current,
            draft: updatedDraft,
            updated_at: new Date().toISOString(),
        };

        await this.put(orgUuid, updated);
        return updated;
    }

    // Flips draft -> data. Leaves `draft` equal to the just-published value (not nulled), same
    // rationale as LocationsService.publish/AboutService.publish. Also fire-and-forget invokes
    // infra/functions/publish-article-listing-page, but ONLY when `hero` or `seo` actually changed since the
    // last publish — unlike Home/Agents (one editable record, always worth re-baking), this record
    // also holds the article list, which changes far more often than the Hero and must never trigger
    // a Hero rebake on its own (see backlogs/real-estate-template/children/articles-page-ssr-split's
    // whole point: decouple Hero-bake frequency from article-list churn).
    //
    // `rebakeListing` forces the listing-page generator even when hero/seo are unchanged. The Hero card
    // on /article-listing sends it: publishing there means "make the live page match this", which must
    // work when nothing was edited (e.g. the site was rebuilt/redeployed and its baked Hero was
    // overwritten by the static template, or an earlier bake failed). Without it that publish saved
    // nothing new, invoked nothing, and silently left the page stale. The article-list publish
    // (ArticlesPage) never sends it, so list churn still can't trigger a Hero rebake.
    public async publish(orgUuid: string, options: { rebakeListing?: boolean } = {}): Promise<ArticlesRecord> {
        const current = await this.get(orgUuid);
        if (!current.draft) {
            throw new NoDraftToPublishError();
        }

        // `seo` is baked by the same generator as `hero` (it patches the page's <head> tags too), so an
        // SEO-only edit must fire it as well — gating on `hero` alone left SEO-only publishes saved but
        // never baked until the Hero next changed.
        const heroOrSeoChanged =
            JSON.stringify(current.data?.hero) !== JSON.stringify(current.draft.hero) ||
            JSON.stringify(current.data?.seo) !== JSON.stringify(current.draft.seo) ||
            options.rebakeListing === true;

        const updated: ArticlesRecord = {
            ...current,
            data: current.draft,
            published_at: new Date().toISOString(),
        };

        await this.put(orgUuid, updated);

        // Per-article detail pages — only the slugs that actually changed since the last publish,
        // never the whole list (see publish-article-detail-page's own comment in infra/template.yaml
        // for the full rationale).
        const { addedOrChanged, removed } = diffArticleSlugs(current.data?.articles ?? [], current.draft.articles);

        // Decide up front which generators will actually fire so the status item knows what to wait for.
        const willBakeListing = heroOrSeoChanged && !!PUBLISH_ARTICLE_LISTING_PAGE_FUNCTION_NAME;
        const willBakeDetail =
            (addedOrChanged.length > 0 || removed.length > 0) && !!PUBLISH_ARTICLE_DETAIL_PAGE_FUNCTION_NAME;
        const expected: string[] = [];
        if (willBakeListing) expected.push('article-listing-page');
        if (willBakeDetail) expected.push('article-detail-page');
        const publishId = await tryStartPublish(orgUuid, 'articles', expected);

        if (willBakeListing) {
            try {
                await lambdaClient.send(
                    new InvokeCommand({
                        FunctionName: PUBLISH_ARTICLE_LISTING_PAGE_FUNCTION_NAME,
                        InvocationType: 'Event',
                        Payload: JSON.stringify({
                            organisation_uuid: orgUuid,
                            publish_id: publishId,
                            page_key: 'articles',
                        }),
                    }),
                );
            } catch (error) {
                console.error(
                    'Failed to invoke publish-article-listing-page — articles published, but Hero regeneration was not started',
                    error,
                );
                await markJobFailedToStart(
                    orgUuid,
                    'articles',
                    publishId,
                    'article-listing-page',
                    startFailureReason(error),
                );
            }
        }

        if (willBakeDetail) {
            try {
                await lambdaClient.send(
                    new InvokeCommand({
                        FunctionName: PUBLISH_ARTICLE_DETAIL_PAGE_FUNCTION_NAME,
                        InvocationType: 'Event',
                        Payload: JSON.stringify({
                            organisation_uuid: orgUuid,
                            added_or_changed_slugs: addedOrChanged,
                            removed_slugs: removed,
                            publish_id: publishId,
                            page_key: 'articles',
                        }),
                    }),
                );
            } catch (error) {
                console.error(
                    'Failed to invoke publish-article-detail-page — articles published, but detail page regeneration was not started',
                    error,
                );
                await markJobFailedToStart(
                    orgUuid,
                    'articles',
                    publishId,
                    'article-detail-page',
                    startFailureReason(error),
                );
            }
        }

        return updated;
    }
}
