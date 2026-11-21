import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { Service } from '@devyethiha/samjs';
import { markJobFailedToStart, startFailureReason, tryStartPublish } from './publish-status';
import { SOCIAL_NETWORKS } from '@sale-sync/shared/src/types';
import type { SocialsContent, SocialsRecord } from '@sale-sync/shared/src/types';

// No hardcoded fallback: staging/prod are different tables, so an unset env var must fail loud.
// Read lazily so tests' env var setup is picked up.
function getTable(): string {
    const table = process.env.ORGANISATION_TABLE_NAME;
    if (!table) {
        throw new Error('ORGANISATION_TABLE_NAME environment variable is not set');
    }
    return table;
}

const lambdaClient = new LambdaClient({});

// The page generators in ss/infra (a different SAM app/stack) that bake the footer socials. Each env
// var is the function name wired in api/template.yaml; a target whose env var is unset is skipped.
// `generator` is the name the Lambda reports its result under (see publish-status.ts's `expected`).
// Detail generators also take (empty) slug lists; publish-blocknote-singleton is invoked once per page.
type FooterTarget = { env: string; generator: string; extra?: Record<string, unknown> };

const BLOCKNOTE_PAGES = ['about', 'privacy-policy', 'terms-and-conditions'] as const;

const FOOTER_TARGETS: FooterTarget[] = [
    { env: 'PUBLISH_REAL_ESTATE_HOME_PAGE_FUNCTION_NAME', generator: 'real-estate-home-page' },
    { env: 'PUBLISH_REAL_ESTATE_AGENTS_PAGE_FUNCTION_NAME', generator: 'real-estate-agents-page' },
    { env: 'PUBLISH_REAL_ESTATE_PROPERTIES_PAGE_FUNCTION_NAME', generator: 'real-estate-properties-page' },
    { env: 'PUBLISH_REAL_ESTATE_MAP_VIEW_PAGE_FUNCTION_NAME', generator: 'real-estate-map-view-page' },
    { env: 'PUBLISH_FAQ_PAGE_FUNCTION_NAME', generator: 'faq-page' },
    { env: 'PUBLISH_CONTACT_PAGE_FUNCTION_NAME', generator: 'contact-page' },
    { env: 'PUBLISH_ARTICLE_LISTING_PAGE_FUNCTION_NAME', generator: 'article-listing-page' },
    { env: 'PUBLISH_LOCATION_LISTING_PAGE_FUNCTION_NAME', generator: 'location-listing-page' },
    {
        env: 'PUBLISH_ARTICLE_DETAIL_PAGE_FUNCTION_NAME',
        generator: 'article-detail-page',
        extra: { added_or_changed_slugs: [], removed_slugs: [] },
    },
    {
        env: 'PUBLISH_LOCATION_DETAIL_PAGE_FUNCTION_NAME',
        generator: 'location-detail-page',
        extra: { added_or_changed_slugs: [], removed_slugs: [] },
    },
    ...BLOCKNOTE_PAGES.map((page) => ({
        env: 'PUBLISH_BLOCKNOTE_SINGLETON_FUNCTION_NAME',
        generator: `blocknote-singleton-${page}`,
        extra: { page },
    })),
];

// Also patches existing property/unit detail pages (shared properties/ prefix), but does not report
// into the publish status (that Lambda never has), so it is invoked outside FOOTER_TARGETS' tracking.
const PROPERTY_DETAIL_ENV = 'PUBLISH_PROPERTY_DETAIL_PAGE_FUNCTION_NAME';

const EMPTY_RECORD: SocialsRecord = {
    data: null,
    draft: null,
    updated_at: new Date(0).toISOString(),
    published_at: null,
};

function emptyContent(): SocialsContent {
    return Object.fromEntries(SOCIAL_NETWORKS.map((network) => [network, ''])) as SocialsContent;
}

export class NoDraftToPublishError extends Error {
    constructor() {
        super('No draft socials changes to publish');
        this.name = 'NoDraftToPublishError';
    }
}

// Mirrors TestimonialsService — singleton per-org record, data/draft split, same publish semantics
// (draft left equal to the just-published value, not nulled). See backlogs/footer-socials-ssr/plan.md.
// publish() flips draft -> data, then fire-and-forget invokes every page generator with
// `footer_only: true` so each re-bakes just its footer socials (see FOOTER_TARGETS). Progress is
// tracked under the 'socials' publish-status key like the other pages.
export class SocialsService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('socials');
        this.DB_Client = DB_Client;
    }

    // Singleton per-org record — PK=ORG#{orgUuid}, SK=SOCIALS.
    public async get(orgUuid: string): Promise<SocialsRecord> {
        const res = await this.DB_Client.send(
            new GetCommand({
                TableName: getTable(),
                Key: { PK: `ORG#${orgUuid}`, SK: 'SOCIALS' },
            }),
        );

        return res.Item ? (JSON.parse(res.Item.data as string) as SocialsRecord) : EMPTY_RECORD;
    }

    private async put(orgUuid: string, record: SocialsRecord): Promise<void> {
        await this.DB_Client.send(
            new PutCommand({
                TableName: getTable(),
                Item: { PK: `ORG#${orgUuid}`, SK: 'SOCIALS', data: JSON.stringify(record) },
            }),
        );
    }

    // Only the networks present in `patch` change; an empty string clears that network.
    public async updateDraft(orgUuid: string, patch: Partial<SocialsContent>): Promise<SocialsRecord> {
        const current = await this.get(orgUuid);
        const updatedDraft: SocialsContent = { ...emptyContent(), ...current.draft };

        for (const network of SOCIAL_NETWORKS) {
            const value = patch[network];
            if (value !== undefined) {
                updatedDraft[network] = value;
            }
        }

        const updated: SocialsRecord = {
            ...current,
            draft: updatedDraft,
            updated_at: new Date().toISOString(),
        };

        await this.put(orgUuid, updated);
        return updated;
    }

    public async publish(orgUuid: string): Promise<SocialsRecord> {
        const current = await this.get(orgUuid);
        if (!current.draft) {
            throw new NoDraftToPublishError();
        }

        const updated: SocialsRecord = {
            ...current,
            data: current.draft,
            published_at: new Date().toISOString(),
        };

        await this.put(orgUuid, updated);
        await this.rebakeFooters(orgUuid);

        return updated;
    }

    // Fire-and-forget: the POST returns before anything is baked; each generator reports its own
    // result into the 'socials' PUBLISH_STATUS# item.
    private async rebakeFooters(orgUuid: string): Promise<void> {
        const targets = FOOTER_TARGETS.flatMap((target) => {
            const functionName = process.env[target.env];
            return functionName ? [{ ...target, functionName }] : [];
        });

        const publishId = await tryStartPublish(
            orgUuid,
            'socials',
            targets.map((target) => target.generator),
        );

        await Promise.all([
            ...targets.map(async (target) => {
                try {
                    await lambdaClient.send(
                        new InvokeCommand({
                            FunctionName: target.functionName,
                            InvocationType: 'Event',
                            Payload: JSON.stringify({
                                organisation_uuid: orgUuid,
                                publish_id: publishId,
                                page_key: 'socials',
                                footer_only: true,
                                ...target.extra,
                            }),
                        }),
                    );
                } catch (error) {
                    console.error(`Failed to invoke ${target.generator} — socials published, but its footer was not re-baked`, error);
                    await markJobFailedToStart(orgUuid, 'socials', publishId, target.generator, startFailureReason(error));
                }
            }),
            this.rebakePropertyPages(orgUuid),
        ]);
    }

    private async rebakePropertyPages(orgUuid: string): Promise<void> {
        const functionName = process.env[PROPERTY_DETAIL_ENV];
        if (!functionName) {
            return;
        }
        try {
            await lambdaClient.send(
                new InvokeCommand({
                    FunctionName: functionName,
                    InvocationType: 'Event',
                    Payload: JSON.stringify({ organisation_uuid: orgUuid, footer_only: true }),
                }),
            );
        } catch (error) {
            console.error('Failed to invoke publish-property-detail-page — socials published, but property pages were not re-baked', error);
        }
    }
}
