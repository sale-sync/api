import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { Service } from '@devyethiha/samjs';
import type { PrivacyPolicyContent, PrivacyPolicyRecord, BlockNoteBlock, SEO } from '@sale-sync/shared/src/types';

// No hardcoded fallback: staging (`staging-sale-sync-organisation`) and prod
// (`sale-sync-organisation`) are different literal tables — a default here would mean a misconfigured
// staging deploy silently writes to the prod table instead of erroring. Same pattern as
// organisation.service.ts's getTable(); read lazily so tests' env var setup is picked up.
function getTable(): string {
    return process.env.ORGANISATION_TABLE_NAME as string;
}

// Same fire-and-forget cross-stack invoke idiom AboutService/BrandingService use —
// publish-blocknote-singleton lives in ss/infra, a different SAM app/stack than this one.
const PUBLISH_BLOCKNOTE_SINGLETON_FUNCTION_NAME = process.env.PUBLISH_BLOCKNOTE_SINGLETON_FUNCTION_NAME;
const lambdaClient = new LambdaClient({});

const EMPTY_RECORD: PrivacyPolicyRecord = {
    data: null,
    draft: null,
    updated_at: new Date(0).toISOString(),
    published_at: null,
};

export class NoDraftToPublishError extends Error {
    constructor() {
        super('No draft privacy-policy changes to publish');
        this.name = 'NoDraftToPublishError';
    }
}

// Mirrors AboutService exactly — singleton per-org record, data/draft split, same publish
// semantics (draft left equal to the just-published value, not nulled).
export class PrivacyPolicyService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('privacy-policy');
        this.DB_Client = DB_Client;
    }

    // Singleton per-org record — PK=ORG#{orgUuid}, SK=PRIVACY_POLICY.
    public async get(orgUuid: string): Promise<PrivacyPolicyRecord> {
        const res = await this.DB_Client.send(
            new GetCommand({
                TableName: getTable(),
                Key: { PK: `ORG#${orgUuid}`, SK: 'PRIVACY_POLICY' },
            }),
        );

        return res.Item ? (JSON.parse(res.Item.data as string) as PrivacyPolicyRecord) : EMPTY_RECORD;
    }

    private async put(orgUuid: string, record: PrivacyPolicyRecord): Promise<void> {
        await this.DB_Client.send(
            new PutCommand({
                TableName: getTable(),
                Item: { PK: `ORG#${orgUuid}`, SK: 'PRIVACY_POLICY', data: JSON.stringify(record) },
            }),
        );
    }

    public async updateDraft(orgUuid: string, blocks: BlockNoteBlock[], seo?: SEO): Promise<PrivacyPolicyRecord> {
        const current = await this.get(orgUuid);
        const updatedDraft: PrivacyPolicyContent = { blocks, seo };

        const updated: PrivacyPolicyRecord = {
            ...current,
            draft: updatedDraft,
            updated_at: new Date().toISOString(),
        };

        await this.put(orgUuid, updated);
        return updated;
    }

    // Flips draft -> data. Leaves `draft` equal to the just-published value (not nulled), same
    // rationale as AboutService.publish/TestimonialsService.publish. Also fire-and-forget invokes
    // infra/functions/publish-blocknote-singleton to bake the newly-published content into the
    // deployed site's dist/ HTML and ssr/ JSON — see AboutService.publish()'s equivalent comment.
    public async publish(orgUuid: string): Promise<PrivacyPolicyRecord> {
        const current = await this.get(orgUuid);
        if (!current.draft) {
            throw new NoDraftToPublishError();
        }

        const updated: PrivacyPolicyRecord = {
            ...current,
            data: current.draft,
            published_at: new Date().toISOString(),
        };

        await this.put(orgUuid, updated);

        if (PUBLISH_BLOCKNOTE_SINGLETON_FUNCTION_NAME) {
            try {
                await lambdaClient.send(
                    new InvokeCommand({
                        FunctionName: PUBLISH_BLOCKNOTE_SINGLETON_FUNCTION_NAME,
                        InvocationType: 'Event',
                        Payload: JSON.stringify({ organisation_uuid: orgUuid, page: 'privacy-policy' }),
                    }),
                );
            } catch (error) {
                console.error(
                    'Failed to invoke publish-blocknote-singleton — privacy-policy published, but SSR regeneration was not started',
                    error,
                );
            }
        }

        return updated;
    }
}
