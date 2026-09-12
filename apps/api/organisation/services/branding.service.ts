import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { Service } from '@devyethiha/samjs';
import type { BrandingContent, BrandingRecord, Image, ThemeFont } from '@sale-sync/shared/src/types';
import { generateColorScale } from './branding-color.util';

const TABLE = process.env.ORGANISATION_TABLE_NAME || 'sale-sync-organisation';

// Same fire-and-forget cross-stack invoke idiom organisation.service.ts already uses for
// INIT_WEBSITE_FUNCTION_NAME — publish-primitive-tokens lives in ss/infra, a different SAM
// app/stack than this one, so there's no CFN GetAtt/import available across the two.
const PUBLISH_PRIMITIVE_TOKENS_FUNCTION_NAME = process.env.PUBLISH_PRIMITIVE_TOKENS_FUNCTION_NAME;
const lambdaClient = new LambdaClient({});

const EMPTY_RECORD: BrandingRecord = {
    data: null,
    draft: null,
    updated_at: new Date(0).toISOString(),
    published_at: null,
    status: 'idle',
    status_reason: null,
};

export class NoDraftToPublishError extends Error {
    constructor() {
        super('No draft branding changes to publish');
        this.name = 'NoDraftToPublishError';
    }
}

export class BrandingService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('branding');
        this.DB_Client = DB_Client;
    }

    // Singleton per-org record — PK=ORG#{orgUuid}, SK=BRANDING. Deliberately not Blocks' collection
    // pattern (PK+begins_with), since there's exactly one branding record per org, not a list.
    public async get(orgUuid: string): Promise<BrandingRecord> {
        const res = await this.DB_Client.send(
            new GetCommand({
                TableName: TABLE,
                Key: { PK: `ORG#${orgUuid}`, SK: 'BRANDING' },
            }),
        );

        return res.Item ? (JSON.parse(res.Item.data as string) as BrandingRecord) : EMPTY_RECORD;
    }

    private async put(orgUuid: string, record: BrandingRecord): Promise<void> {
        await this.DB_Client.send(
            new PutCommand({
                TableName: TABLE,
                Item: { PK: `ORG#${orgUuid}`, SK: 'BRANDING', data: JSON.stringify(record) },
            }),
        );
    }

    public async updateDraft(
        orgUuid: string,
        patch: { primary_hex?: string; secondary_hex?: string; logo?: Image | null; font?: ThemeFont },
    ): Promise<BrandingRecord> {
        const current = await this.get(orgUuid);
        const currentDraft: BrandingContent = current.draft ?? { logo: null, primaryColor: null, secondaryColor: null, font: null };

        const updatedDraft: BrandingContent = {
            ...currentDraft,
            ...(patch.primary_hex !== undefined && {
                primaryColor: { hex: patch.primary_hex, scale: generateColorScale(patch.primary_hex) },
            }),
            ...(patch.secondary_hex !== undefined && {
                secondaryColor: { hex: patch.secondary_hex, scale: generateColorScale(patch.secondary_hex) },
            }),
            ...(patch.logo !== undefined && { logo: patch.logo }),
            ...(patch.font !== undefined && { font: patch.font }),
        };

        const updated: BrandingRecord = {
            ...current,
            draft: updatedDraft,
            updated_at: new Date().toISOString(),
        };

        await this.put(orgUuid, updated);
        return updated;
    }

    // Flips draft -> data. Leaves `draft` equal to the just-published value (not nulled) — "draft"
    // means "what would be republished if you hit Publish again," so the editor never sees a null
    // flash right after publishing. Sets status='generating' and fire-and-forget invokes
    // infra/functions/publish-primitive-tokens to regenerate the deployed site's
    // primitive-tokens.css — this method does not wait for that Lambda to finish; it flips the
    // status and returns. The Lambda itself flips status to 'success'/'fail' when it's done.
    public async publish(orgUuid: string): Promise<BrandingRecord> {
        const current = await this.get(orgUuid);
        if (!current.draft) {
            throw new NoDraftToPublishError();
        }

        const updated: BrandingRecord = {
            ...current,
            data: current.draft,
            published_at: new Date().toISOString(),
            status: 'generating',
            status_reason: null,
        };

        await this.put(orgUuid, updated);

        if (PUBLISH_PRIMITIVE_TOKENS_FUNCTION_NAME) {
            try {
                await lambdaClient.send(
                    new InvokeCommand({
                        FunctionName: PUBLISH_PRIMITIVE_TOKENS_FUNCTION_NAME,
                        InvocationType: 'Event',
                        Payload: JSON.stringify({ organisation_uuid: orgUuid }),
                    }),
                );
            } catch (error) {
                console.error(
                    'Failed to invoke publish-primitive-tokens — branding published, but CSS regeneration was not started',
                    error,
                );
            }
        }

        return updated;
    }
}
