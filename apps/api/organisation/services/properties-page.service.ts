import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { Service } from '@devyethiha/samjs';
import { markJobFailedToStart, startFailureReason, tryStartPublish } from './publish-status';
import type { PropertiesPageHero, PropertiesPageRecord, SEO } from '@sale-sync/shared/src/types';

// No hardcoded fallback: staging/prod are different tables — same pattern as
// organisation.service.ts's getTable()/home.service.ts's getTable(). Read lazily so tests' env var
// setup is picked up.
function getTable(): string {
    return process.env.ORGANISATION_TABLE_NAME as string;
}

// Same fire-and-forget cross-stack invoke idiom AgentsPageService uses — publish-real-estate-properties-page
// lives in ss/infra, a different SAM app/stack than this one, so there's no CFN GetAtt/import available.
const PUBLISH_REAL_ESTATE_PROPERTIES_PAGE_FUNCTION_NAME = process.env.PUBLISH_REAL_ESTATE_PROPERTIES_PAGE_FUNCTION_NAME;
const lambdaClient = new LambdaClient({});

const EMPTY_RECORD: PropertiesPageRecord = {
    data: null,
    draft: null,
    updated_at: new Date(0).toISOString(),
    published_at: null,
};

export class NoDraftToPublishError extends Error {
    constructor() {
        super('No draft properties-page changes to publish');
        this.name = 'NoDraftToPublishError';
    }
}

// Mirrors AgentsPageService — singleton per-org record, data/draft split, same publish semantics
// (draft left equal to the just-published value, not nulled) including the fire-and-forget
// regeneration invoke. Editable: the full Hero (title/subtitle/bannerImage/overlayOpacity) + SEO. The
// filter panel/results grid below the Hero stay pure CSR. Whole-draft replace, no field-level merge
// (unlike Faq/Articles/Locations) since there's no second independently-edited list on this record.
// See backlogs/real-estate-template/children/real-estate-properties-page-hero.
export class PropertiesPageService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('properties-page');
        this.DB_Client = DB_Client;
    }

    // Singleton per-org record — PK=ORG#{orgUuid}, SK=PROPERTIES_PAGE.
    public async get(orgUuid: string): Promise<PropertiesPageRecord> {
        const res = await this.DB_Client.send(
            new GetCommand({
                TableName: getTable(),
                Key: { PK: `ORG#${orgUuid}`, SK: 'PROPERTIES_PAGE' },
            }),
        );

        return res.Item ? (JSON.parse(res.Item.data as string) as PropertiesPageRecord) : EMPTY_RECORD;
    }

    private async put(orgUuid: string, record: PropertiesPageRecord): Promise<void> {
        await this.DB_Client.send(
            new PutCommand({
                TableName: getTable(),
                Item: { PK: `ORG#${orgUuid}`, SK: 'PROPERTIES_PAGE', data: JSON.stringify(record) },
            }),
        );
    }

    public async updateDraft(orgUuid: string, hero: PropertiesPageHero, seo?: SEO): Promise<PropertiesPageRecord> {
        const current = await this.get(orgUuid);

        const updated: PropertiesPageRecord = {
            ...current,
            draft: { hero, seo },
            updated_at: new Date().toISOString(),
        };

        await this.put(orgUuid, updated);
        return updated;
    }

    // Flips draft -> data. Leaves `draft` equal to the just-published value (not nulled), same
    // rationale as HomeService.publish(). Also fire-and-forget invokes
    // infra/functions/publish-real-estate-properties-page to bake the newly-published Hero + SEO into the
    // deployed site's dist/properties HTML and ssr/properties JSON — this method does not wait for that
    // Lambda to finish; see HomeService.publish()'s equivalent comment for the same
    // status-lifecycle caveat (PropertiesPageRecord has no status/status_reason field either).
    public async publish(orgUuid: string): Promise<PropertiesPageRecord> {
        const current = await this.get(orgUuid);
        if (!current.draft) {
            throw new NoDraftToPublishError();
        }

        const updated: PropertiesPageRecord = {
            ...current,
            data: current.draft,
            published_at: new Date().toISOString(),
        };

        await this.put(orgUuid, updated);

        const publishId = await tryStartPublish(
            orgUuid,
            'properties',
            PUBLISH_REAL_ESTATE_PROPERTIES_PAGE_FUNCTION_NAME ? ['real-estate-properties-page'] : [],
        );

        if (PUBLISH_REAL_ESTATE_PROPERTIES_PAGE_FUNCTION_NAME) {
            try {
                await lambdaClient.send(
                    new InvokeCommand({
                        FunctionName: PUBLISH_REAL_ESTATE_PROPERTIES_PAGE_FUNCTION_NAME,
                        InvocationType: 'Event',
                        Payload: JSON.stringify({
                            organisation_uuid: orgUuid,
                            publish_id: publishId,
                            page_key: 'properties',
                        }),
                    }),
                );
            } catch (error) {
                console.error(
                    'Failed to invoke publish-real-estate-properties-page — properties page published, but Hero regeneration was not started',
                    error,
                );
                await markJobFailedToStart(
                    orgUuid,
                    'properties',
                    publishId,
                    'real-estate-properties-page',
                    startFailureReason(error),
                );
            }
        }

        return updated;
    }
}
