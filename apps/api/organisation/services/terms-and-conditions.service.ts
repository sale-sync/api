import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { Service } from '@devyethiha/samjs';
import type {
    TermsAndConditionsContent,
    TermsAndConditionsRecord,
    BlockNoteBlock,
    SEO,
} from '@sale-sync/shared/src/types';

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

const EMPTY_RECORD: TermsAndConditionsRecord = {
    data: null,
    draft: null,
    updated_at: new Date(0).toISOString(),
    published_at: null,
};

export class NoDraftToPublishError extends Error {
    constructor() {
        super('No draft terms-and-conditions changes to publish');
        this.name = 'NoDraftToPublishError';
    }
}

// Mirrors AboutService/PrivacyPolicyService exactly — singleton per-org record, data/draft split,
// same publish semantics (draft left equal to the just-published value, not nulled).
export class TermsAndConditionsService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('terms-and-conditions');
        this.DB_Client = DB_Client;
    }

    // Singleton per-org record — PK=ORG#{orgUuid}, SK=TERMS_AND_CONDITIONS.
    public async get(orgUuid: string): Promise<TermsAndConditionsRecord> {
        const res = await this.DB_Client.send(
            new GetCommand({
                TableName: getTable(),
                Key: { PK: `ORG#${orgUuid}`, SK: 'TERMS_AND_CONDITIONS' },
            }),
        );

        return res.Item
            ? (JSON.parse(res.Item.data as string) as TermsAndConditionsRecord)
            : EMPTY_RECORD;
    }

    private async put(orgUuid: string, record: TermsAndConditionsRecord): Promise<void> {
        await this.DB_Client.send(
            new PutCommand({
                TableName: getTable(),
                Item: { PK: `ORG#${orgUuid}`, SK: 'TERMS_AND_CONDITIONS', data: JSON.stringify(record) },
            }),
        );
    }

    public async updateDraft(orgUuid: string, blocks: BlockNoteBlock[], seo?: SEO): Promise<TermsAndConditionsRecord> {
        const current = await this.get(orgUuid);
        const updatedDraft: TermsAndConditionsContent = { blocks, seo };

        const updated: TermsAndConditionsRecord = {
            ...current,
            draft: updatedDraft,
            updated_at: new Date().toISOString(),
        };

        await this.put(orgUuid, updated);
        return updated;
    }

    // Flips draft -> data. Leaves `draft` equal to the just-published value (not nulled), same
    // rationale as AboutService.publish/PrivacyPolicyService.publish. Also fire-and-forget invokes
    // infra/functions/publish-blocknote-singleton to bake the newly-published content into the
    // deployed site's dist/ HTML and ssr/ JSON — see AboutService.publish()'s equivalent comment.
    public async publish(orgUuid: string): Promise<TermsAndConditionsRecord> {
        const current = await this.get(orgUuid);
        if (!current.draft) {
            throw new NoDraftToPublishError();
        }

        const updated: TermsAndConditionsRecord = {
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
                        Payload: JSON.stringify({ organisation_uuid: orgUuid, page: 'terms-and-conditions' }),
                    }),
                );
            } catch (error) {
                console.error(
                    'Failed to invoke publish-blocknote-singleton — terms-and-conditions published, but SSR regeneration was not started',
                    error,
                );
            }
        }

        return updated;
    }
}
