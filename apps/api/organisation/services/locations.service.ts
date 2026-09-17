import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { Service } from '@devyethiha/samjs';
import type { LocationItem, LocationsContent, LocationsHero, LocationsRecord, SEO } from '@sale-sync/shared/src/types';
import { normalizeLocationsContent } from '@sale-sync/shared';

// A PATCH may update just one of these — see LocationsContent's own comment (libs/shared) for why
// updateDraft() merges rather than full-replaces.
export type UpdateLocationsDraftPatch = {
    locations?: LocationItem[];
    hero?: LocationsHero;
    seo?: SEO;
};

// No hardcoded fallback — see about.service.ts's getTable() for the full rationale (staging/prod use
// different literal table names; a default here would mean a misconfigured staging deploy silently
// writes to the prod table instead of erroring).
function getTable(): string {
    return process.env.ORGANISATION_TABLE_NAME as string;
}

// Same fire-and-forget cross-stack invoke idiom ArticlesService uses —
// publish-location-listing-page/publish-location-detail-page live in ss/infra, a different SAM
// app/stack than this one.
const PUBLISH_LOCATION_LISTING_PAGE_FUNCTION_NAME = process.env.PUBLISH_LOCATION_LISTING_PAGE_FUNCTION_NAME;
const PUBLISH_LOCATION_DETAIL_PAGE_FUNCTION_NAME = process.env.PUBLISH_LOCATION_DETAIL_PAGE_FUNCTION_NAME;
const lambdaClient = new LambdaClient({});

// Slug-based diff between the previously-published location list and the one about to be published —
// publish-location-detail-page is invoked with only what actually changed, never the whole list (see
// backlogs/real-estate-template/children/locations-page-ssr-split/plan.md's whole rationale: adding
// one location shouldn't regenerate every other location's page). Deep-equal by JSON.stringify since
// LocationItem's field order is stable (always constructed the same way, by the zod-validated DTO
// parse or by re-spreading an already-parsed item — see LocationForm.tsx's web-app callsite). Verbatim
// copy of ArticlesService's diffArticleSlugs().
function diffLocationSlugs(
    oldLocations: LocationItem[],
    newLocations: LocationItem[],
): { addedOrChanged: string[]; removed: string[] } {
    const oldBySlug = new Map(oldLocations.map((location) => [location.slug, location]));
    const newBySlug = new Map(newLocations.map((location) => [location.slug, location]));

    const addedOrChanged: string[] = [];
    for (const [slug, location] of newBySlug) {
        const previous = oldBySlug.get(slug);
        if (!previous || JSON.stringify(previous) !== JSON.stringify(location)) {
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

// Mirrors ArticlesService exactly — singleton per-org record, data/draft split, same publish
// semantics (draft left equal to the just-published value, not nulled). Holds a list
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

    // Field-level merge, not a full replace: `locations` still has the same full-array-replace
    // contract it always has when present, but `hero`/`seo` fall back to whatever's already in the
    // current draft when omitted from this particular patch. This is what lets LocationComp (web-app)
    // keep PATCHing just `{ locations }` on every single-location save without wiping out a
    // separately-saved Hero/SEO — and lets a Hero-only editor PATCH just `{ hero, seo }` without
    // needing to resend the whole location list. Verbatim copy of ArticlesService.updateDraft()'s
    // merge shape.
    public async updateDraft(orgUuid: string, patch: UpdateLocationsDraftPatch): Promise<LocationsRecord> {
        const current = await this.get(orgUuid);

        const updatedDraft: LocationsContent = {
            locations: patch.locations ?? current.draft?.locations ?? [],
            hero: patch.hero ?? current.draft?.hero,
            seo: patch.seo ?? current.draft?.seo,
        };

        const updated: LocationsRecord = {
            ...current,
            draft: updatedDraft,
            updated_at: new Date().toISOString(),
        };

        await this.put(orgUuid, updated);
        return updated;
    }

    // Flips draft -> data. Leaves `draft` equal to the just-published value (not nulled), same
    // rationale as ArticlesService.publish/AboutService.publish. Also fire-and-forget invokes
    // infra/functions/publish-location-listing-page, but ONLY when `hero` actually changed since the
    // last publish — unlike Home/Agents (one editable record, always worth re-baking), this record
    // also holds the location list, which changes far more often than the Hero and must never trigger
    // a Hero rebake on its own (see backlogs/real-estate-template/children/locations-page-ssr-split's
    // whole point: decouple Hero-bake frequency from location-list churn). Also fire-and-forget
    // invokes publish-location-detail-page with only the slug(s) that actually changed.
    public async publish(orgUuid: string): Promise<LocationsRecord> {
        const current = await this.get(orgUuid);
        if (!current.draft) {
            throw new NoDraftToPublishError();
        }

        const heroChanged = JSON.stringify(current.data?.hero) !== JSON.stringify(current.draft.hero);

        const updated: LocationsRecord = {
            ...current,
            data: current.draft,
            published_at: new Date().toISOString(),
        };

        await this.put(orgUuid, updated);

        if (heroChanged && PUBLISH_LOCATION_LISTING_PAGE_FUNCTION_NAME) {
            try {
                await lambdaClient.send(
                    new InvokeCommand({
                        FunctionName: PUBLISH_LOCATION_LISTING_PAGE_FUNCTION_NAME,
                        InvocationType: 'Event',
                        Payload: JSON.stringify({ organisation_uuid: orgUuid }),
                    }),
                );
            } catch (error) {
                console.error(
                    'Failed to invoke publish-location-listing-page — locations published, but Hero regeneration was not started',
                    error,
                );
            }
        }

        // Per-location detail pages — only the slugs that actually changed since the last publish,
        // never the whole list (see publish-location-detail-page's own comment in infra/template.yaml
        // for the full rationale).
        const { addedOrChanged, removed } = diffLocationSlugs(current.data?.locations ?? [], current.draft.locations);

        if ((addedOrChanged.length > 0 || removed.length > 0) && PUBLISH_LOCATION_DETAIL_PAGE_FUNCTION_NAME) {
            try {
                await lambdaClient.send(
                    new InvokeCommand({
                        FunctionName: PUBLISH_LOCATION_DETAIL_PAGE_FUNCTION_NAME,
                        InvocationType: 'Event',
                        Payload: JSON.stringify({
                            organisation_uuid: orgUuid,
                            added_or_changed_slugs: addedOrChanged,
                            removed_slugs: removed,
                        }),
                    }),
                );
            } catch (error) {
                console.error(
                    'Failed to invoke publish-location-detail-page — locations published, but detail page regeneration was not started',
                    error,
                );
            }
        }

        return updated;
    }
}
