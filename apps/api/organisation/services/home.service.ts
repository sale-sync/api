import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { Service } from '@devyethiha/samjs';
import { markJobFailedToStart, startFailureReason, tryStartPublish } from './publish-status';
import type { HeroContent, HomePageRecord, SEO } from '@sale-sync/shared/src/types';

// No hardcoded fallback: staging/prod are different tables — same pattern as
// organisation.service.ts's getTable()/about.service.ts's getTable(). Read lazily so tests' env var
// setup is picked up.
function getTable(): string {
    return process.env.ORGANISATION_TABLE_NAME as string;
}

// Same fire-and-forget cross-stack invoke idiom AboutService uses for
// PUBLISH_BLOCKNOTE_SINGLETON_FUNCTION_NAME — publish-real-estate-home-page lives in ss/infra, a
// different SAM app/stack than this one, so there's no CFN GetAtt/import available across the two.
const PUBLISH_REAL_ESTATE_HOME_PAGE_FUNCTION_NAME = process.env.PUBLISH_REAL_ESTATE_HOME_PAGE_FUNCTION_NAME;
const lambdaClient = new LambdaClient({});

const EMPTY_RECORD: HomePageRecord = {
    data: null,
    draft: null,
    updated_at: new Date(0).toISOString(),
    published_at: null,
};

export class NoDraftToPublishError extends Error {
    constructor() {
        super('No draft home-page changes to publish');
        this.name = 'NoDraftToPublishError';
    }
}

// Mirrors AboutService exactly — singleton per-org record, data/draft split, same publish semantics
// (draft left equal to the just-published value, not nulled), including the fire-and-forget
// regeneration invoke on publish. Unlike About/Privacy Policy/Terms & Conditions, this page's Hero
// section isn't a BlockNote document — it has its own dedicated 'real-estate-home-page' generator
// (publish-real-estate-home-page, see api/libs/shared/src/types/template.ts's PageGenerator) rather
// than reusing 'blocknote-singleton'. `real-estate-home-page`'s other two sections (Featured
// Properties, Testimonials) stay CSR/live from queries-api — this generator only ever touches the
// Hero portion of the page.
export class HomeService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('home');
        this.DB_Client = DB_Client;
    }

    // Singleton per-org record — PK=ORG#{orgUuid}, SK=HOME_PAGE.
    public async get(orgUuid: string): Promise<HomePageRecord> {
        const res = await this.DB_Client.send(
            new GetCommand({
                TableName: getTable(),
                Key: { PK: `ORG#${orgUuid}`, SK: 'HOME_PAGE' },
            }),
        );

        return res.Item ? (JSON.parse(res.Item.data as string) as HomePageRecord) : EMPTY_RECORD;
    }

    private async put(orgUuid: string, record: HomePageRecord): Promise<void> {
        await this.DB_Client.send(
            new PutCommand({
                TableName: getTable(),
                Item: { PK: `ORG#${orgUuid}`, SK: 'HOME_PAGE', data: JSON.stringify(record) },
            }),
        );
    }

    public async updateDraft(orgUuid: string, hero: HeroContent, seo?: SEO): Promise<HomePageRecord> {
        const current = await this.get(orgUuid);

        const updated: HomePageRecord = {
            ...current,
            draft: { hero, seo },
            updated_at: new Date().toISOString(),
        };

        await this.put(orgUuid, updated);
        return updated;
    }

    // Flips draft -> data. Leaves `draft` equal to the just-published value (not nulled), same
    // rationale as AboutService.publish(). Also fire-and-forget invokes
    // infra/functions/publish-real-estate-home-page to bake the newly-published Hero content into
    // the deployed site's dist/index HTML and ssr/index JSON — this method does not wait for that
    // Lambda to finish; see AboutService.publish()'s equivalent comment for the same
    // status-lifecycle caveat (HomePageRecord has no status/status_reason field either).
    public async publish(orgUuid: string): Promise<HomePageRecord> {
        const current = await this.get(orgUuid);
        if (!current.draft) {
            throw new NoDraftToPublishError();
        }

        const updated: HomePageRecord = {
            ...current,
            data: current.draft,
            published_at: new Date().toISOString(),
        };

        await this.put(orgUuid, updated);

        const publishId = await tryStartPublish(
            orgUuid,
            'home',
            PUBLISH_REAL_ESTATE_HOME_PAGE_FUNCTION_NAME ? ['real-estate-home-page'] : [],
        );

        if (PUBLISH_REAL_ESTATE_HOME_PAGE_FUNCTION_NAME) {
            try {
                await lambdaClient.send(
                    new InvokeCommand({
                        FunctionName: PUBLISH_REAL_ESTATE_HOME_PAGE_FUNCTION_NAME,
                        InvocationType: 'Event',
                        Payload: JSON.stringify({
                            organisation_uuid: orgUuid,
                            publish_id: publishId,
                            page_key: 'home',
                        }),
                    }),
                );
            } catch (error) {
                console.error(
                    'Failed to invoke publish-real-estate-home-page — home page published, but Hero regeneration was not started',
                    error,
                );
                await markJobFailedToStart(
                    orgUuid,
                    'home',
                    publishId,
                    'real-estate-home-page',
                    startFailureReason(error),
                );
            }
        }

        return updated;
    }
}
