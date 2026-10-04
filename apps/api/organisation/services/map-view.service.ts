import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { Service } from '@devyethiha/samjs';
import { markJobFailedToStart, startFailureReason, tryStartPublish } from './publish-status';
import type { MapViewRecord, SEO } from '@sale-sync/shared/src/types';

// No hardcoded fallback: staging/prod are different tables — same pattern as
// organisation.service.ts's getTable()/home.service.ts's getTable(). Read lazily so tests' env var
// setup is picked up.
function getTable(): string {
    return process.env.ORGANISATION_TABLE_NAME as string;
}

// Same fire-and-forget cross-stack invoke idiom AgentsPageService uses — publish-real-estate-map-view-page
// lives in ss/infra, a different SAM app/stack than this one, so there's no CFN GetAtt/import available.
const PUBLISH_REAL_ESTATE_MAP_VIEW_PAGE_FUNCTION_NAME = process.env.PUBLISH_REAL_ESTATE_MAP_VIEW_PAGE_FUNCTION_NAME;
const lambdaClient = new LambdaClient({});

const EMPTY_RECORD: MapViewRecord = {
    data: null,
    draft: null,
    updated_at: new Date(0).toISOString(),
    published_at: null,
};

export class NoDraftToPublishError extends Error {
    constructor() {
        super('No draft map-view changes to publish');
        this.name = 'NoDraftToPublishError';
    }
}

// Mirrors AgentsPageService — singleton per-org record, data/draft split, same publish semantics
// (draft left equal to the just-published value, not nulled) including the fire-and-forget
// regeneration invoke. Unlike Agents' banner, the Map View page has no editable body at all (it's
// 100% CSR): SEO is the record's entire content, so every publish is by definition an SEO change and
// there's no "did X change?" diff before invoking. See
// backlogs/real-estate-template/children/real-estate-map-view-seo.
export class MapViewService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('map-view');
        this.DB_Client = DB_Client;
    }

    // Singleton per-org record — PK=ORG#{orgUuid}, SK=MAP_VIEW.
    public async get(orgUuid: string): Promise<MapViewRecord> {
        const res = await this.DB_Client.send(
            new GetCommand({
                TableName: getTable(),
                Key: { PK: `ORG#${orgUuid}`, SK: 'MAP_VIEW' },
            }),
        );

        return res.Item ? (JSON.parse(res.Item.data as string) as MapViewRecord) : EMPTY_RECORD;
    }

    private async put(orgUuid: string, record: MapViewRecord): Promise<void> {
        await this.DB_Client.send(
            new PutCommand({
                TableName: getTable(),
                Item: { PK: `ORG#${orgUuid}`, SK: 'MAP_VIEW', data: JSON.stringify(record) },
            }),
        );
    }

    public async updateDraft(orgUuid: string, seo: SEO): Promise<MapViewRecord> {
        const current = await this.get(orgUuid);

        const updated: MapViewRecord = {
            ...current,
            draft: { seo },
            updated_at: new Date().toISOString(),
        };

        await this.put(orgUuid, updated);
        return updated;
    }

    // Flips draft -> data. Leaves `draft` equal to the just-published value (not nulled), same
    // rationale as HomeService.publish(). Also fire-and-forget invokes
    // infra/functions/publish-real-estate-map-view-page to bake the newly-published SEO into the
    // deployed site's dist/map HTML and ssr/map JSON — this method does not wait for that
    // Lambda to finish; see HomeService.publish()'s equivalent comment for the same
    // status-lifecycle caveat (MapViewRecord has no status/status_reason field either).
    public async publish(orgUuid: string): Promise<MapViewRecord> {
        const current = await this.get(orgUuid);
        if (!current.draft) {
            throw new NoDraftToPublishError();
        }

        const updated: MapViewRecord = {
            ...current,
            data: current.draft,
            published_at: new Date().toISOString(),
        };

        await this.put(orgUuid, updated);

        const publishId = await tryStartPublish(
            orgUuid,
            'map-view',
            PUBLISH_REAL_ESTATE_MAP_VIEW_PAGE_FUNCTION_NAME ? ['real-estate-map-view-page'] : [],
        );

        if (PUBLISH_REAL_ESTATE_MAP_VIEW_PAGE_FUNCTION_NAME) {
            try {
                await lambdaClient.send(
                    new InvokeCommand({
                        FunctionName: PUBLISH_REAL_ESTATE_MAP_VIEW_PAGE_FUNCTION_NAME,
                        InvocationType: 'Event',
                        Payload: JSON.stringify({
                            organisation_uuid: orgUuid,
                            publish_id: publishId,
                            page_key: 'map-view',
                        }),
                    }),
                );
            } catch (error) {
                console.error(
                    'Failed to invoke publish-real-estate-map-view-page — map view page published, but SEO regeneration was not started',
                    error,
                );
                await markJobFailedToStart(
                    orgUuid,
                    'map-view',
                    publishId,
                    'real-estate-map-view-page',
                    startFailureReason(error),
                );
            }
        }

        return updated;
    }
}
