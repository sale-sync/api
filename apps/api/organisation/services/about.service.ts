import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { Service } from '@devyethiha/samjs';
import { markJobFailedToStart, startFailureReason, tryStartPublish } from './publish-status';
import type { AboutPageContent, AboutPageRecord, BlockNoteBlock, SEO } from '@sale-sync/shared/src/types';

// No hardcoded fallback: staging (`staging-sale-sync-organisation`) and prod
// (`sale-sync-organisation`) are different literal tables — a default here would mean a misconfigured
// staging deploy silently writes to the prod table instead of erroring. Same pattern as
// organisation.service.ts's getTable(); read lazily so tests' env var setup is picked up.
function getTable(): string {
    return process.env.ORGANISATION_TABLE_NAME as string;
}

// Same fire-and-forget cross-stack invoke idiom BrandingService uses for
// PUBLISH_PRIMITIVE_TOKENS_FUNCTION_NAME — publish-blocknote-singleton lives in ss/infra, a
// different SAM app/stack than this one, so there's no CFN GetAtt/import available across the two.
const PUBLISH_BLOCKNOTE_SINGLETON_FUNCTION_NAME = process.env.PUBLISH_BLOCKNOTE_SINGLETON_FUNCTION_NAME;
const lambdaClient = new LambdaClient({});

const EMPTY_RECORD: AboutPageRecord = {
    data: null,
    draft: null,
    updated_at: new Date(0).toISOString(),
    published_at: null,
};

export class NoDraftToPublishError extends Error {
    constructor() {
        super('No draft about-page changes to publish');
        this.name = 'NoDraftToPublishError';
    }
}

// Mirrors TestimonialsService/BrandingService exactly — singleton per-org record, data/draft split,
// same publish semantics (draft left equal to the just-published value, not nulled).
export class AboutService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('about');
        this.DB_Client = DB_Client;
    }

    // Singleton per-org record — PK=ORG#{orgUuid}, SK=ABOUT_PAGE.
    public async get(orgUuid: string): Promise<AboutPageRecord> {
        const res = await this.DB_Client.send(
            new GetCommand({
                TableName: getTable(),
                Key: { PK: `ORG#${orgUuid}`, SK: 'ABOUT_PAGE' },
            }),
        );

        return res.Item ? (JSON.parse(res.Item.data as string) as AboutPageRecord) : EMPTY_RECORD;
    }

    private async put(orgUuid: string, record: AboutPageRecord): Promise<void> {
        await this.DB_Client.send(
            new PutCommand({
                TableName: getTable(),
                Item: { PK: `ORG#${orgUuid}`, SK: 'ABOUT_PAGE', data: JSON.stringify(record) },
            }),
        );
    }

    public async updateDraft(orgUuid: string, blocks: BlockNoteBlock[], seo?: SEO): Promise<AboutPageRecord> {
        const current = await this.get(orgUuid);
        const updatedDraft: AboutPageContent = { blocks, seo };

        const updated: AboutPageRecord = {
            ...current,
            draft: updatedDraft,
            updated_at: new Date().toISOString(),
        };

        await this.put(orgUuid, updated);
        return updated;
    }

    // Flips draft -> data. Leaves `draft` equal to the just-published value (not nulled), same
    // rationale as TestimonialsService.publish/BrandingService.publish. Also fire-and-forget
    // invokes infra/functions/publish-blocknote-singleton to bake the newly-published content into
    // the deployed site's dist/ HTML and ssr/ JSON — this method does not wait for that Lambda to
    // finish; see BrandingService.publish()'s equivalent comment for the same status-lifecycle
    // caveat (though unlike Branding, AboutPageRecord has no status/status_reason field yet).
    public async publish(orgUuid: string): Promise<AboutPageRecord> {
        const current = await this.get(orgUuid);
        if (!current.draft) {
            throw new NoDraftToPublishError();
        }

        const updated: AboutPageRecord = {
            ...current,
            data: current.draft,
            published_at: new Date().toISOString(),
        };

        await this.put(orgUuid, updated);

        const publishId = await tryStartPublish(
            orgUuid,
            'about',
            PUBLISH_BLOCKNOTE_SINGLETON_FUNCTION_NAME ? ['blocknote-singleton'] : [],
        );

        if (PUBLISH_BLOCKNOTE_SINGLETON_FUNCTION_NAME) {
            try {
                await lambdaClient.send(
                    new InvokeCommand({
                        FunctionName: PUBLISH_BLOCKNOTE_SINGLETON_FUNCTION_NAME,
                        InvocationType: 'Event',
                        Payload: JSON.stringify({
                            organisation_uuid: orgUuid,
                            page: 'about',
                            publish_id: publishId,
                            page_key: 'about',
                        }),
                    }),
                );
            } catch (error) {
                console.error(
                    'Failed to invoke publish-blocknote-singleton — about page published, but SSR regeneration was not started',
                    error,
                );
                await markJobFailedToStart(
                    orgUuid,
                    'about',
                    publishId,
                    'blocknote-singleton',
                    startFailureReason(error),
                );
            }
        }

        return updated;
    }
}
