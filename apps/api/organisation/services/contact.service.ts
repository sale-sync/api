import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { Service } from '@devyethiha/samjs';
import { markJobFailedToStart, startFailureReason, tryStartPublish } from './publish-status';
import type { ContactBusinessInfo, ContactContent, ContactRecord, SEO } from '@sale-sync/shared/src/types';

// A PATCH may update just one of these — see updateDraft() for the merge.
export type UpdateContactDraftPatch = {
    title?: string;
    subtitle?: string;
    businessInfo?: ContactBusinessInfo;
    seo?: SEO;
};

// No hardcoded fallback — see about.service.ts's getTable() for the full rationale (staging/prod use
// different literal table names; a default here would mean a misconfigured staging deploy silently
// writes to the prod table instead of erroring).
function getTable(): string {
    return process.env.ORGANISATION_TABLE_NAME as string;
}

// Same fire-and-forget cross-stack invoke idiom FaqService/ArticlesService use — publish-contact-page
// lives in ss/infra, a different SAM app/stack than this one.
const PUBLISH_CONTACT_PAGE_FUNCTION_NAME = process.env.PUBLISH_CONTACT_PAGE_FUNCTION_NAME;
const lambdaClient = new LambdaClient({});

const EMPTY_RECORD: ContactRecord = {
    data: null,
    draft: null,
    updated_at: new Date(0).toISOString(),
    published_at: null,
};

export class NoDraftToPublishError extends Error {
    constructor() {
        super('No draft Contact page changes to publish');
        this.name = 'NoDraftToPublishError';
    }
}

// Singleton per-org record (PK=ORG#{orgUuid}, SK=CONTACT), data/draft split, same publish semantics as
// FaqService (draft left equal to the just-published value, not nulled). Unlike FAQ there is no list
// content here, so every field is baked by the one generator and any change to any of them rebakes.
// See backlogs/contact-page.
export class ContactService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('contact');
        this.DB_Client = DB_Client;
    }

    public async get(orgUuid: string): Promise<ContactRecord> {
        const res = await this.DB_Client.send(
            new GetCommand({
                TableName: getTable(),
                Key: { PK: `ORG#${orgUuid}`, SK: 'CONTACT' },
            }),
        );

        if (!res.Item) return EMPTY_RECORD;

        return JSON.parse(res.Item.data as string) as ContactRecord;
    }

    private async put(orgUuid: string, record: ContactRecord): Promise<void> {
        await this.DB_Client.send(
            new PutCommand({
                TableName: getTable(),
                Item: { PK: `ORG#${orgUuid}`, SK: 'CONTACT', data: JSON.stringify(record) },
            }),
        );
    }

    // Field-level merge, not a full replace: each field is independently optional, falling back to
    // whatever's already in the current draft when omitted from this patch.
    public async updateDraft(orgUuid: string, patch: UpdateContactDraftPatch): Promise<ContactRecord> {
        const current = await this.get(orgUuid);

        const updatedDraft: ContactContent = {
            title: patch.title ?? current.draft?.title,
            subtitle: patch.subtitle ?? current.draft?.subtitle,
            businessInfo: patch.businessInfo ?? current.draft?.businessInfo,
            seo: patch.seo ?? current.draft?.seo,
        };

        const updated: ContactRecord = {
            ...current,
            draft: updatedDraft,
            updated_at: new Date().toISOString(),
        };

        await this.put(orgUuid, updated);
        return updated;
    }

    // Flips draft -> data, then fire-and-forget invokes infra/functions/publish-contact-page when
    // anything baked changed since the last publish (title, subtitle, businessInfo or seo — all are
    // baked, and SEO-only edits must bake too, see FaqService.publish()'s own comment on that bug).
    // `rebake` forces the generator even when nothing changed, so publishing from the editor can
    // always make the live page match (e.g. after a site rebuild overwrote the baked content).
    public async publish(orgUuid: string, options: { rebake?: boolean } = {}): Promise<ContactRecord> {
        const current = await this.get(orgUuid);
        if (!current.draft) {
            throw new NoDraftToPublishError();
        }

        const draft = current.draft;
        const changed =
            (['title', 'subtitle', 'businessInfo', 'seo'] as const).some(
                (key) => JSON.stringify(current.data?.[key]) !== JSON.stringify(draft[key]),
            ) || options.rebake === true;

        const updated: ContactRecord = {
            ...current,
            data: current.draft,
            published_at: new Date().toISOString(),
        };

        await this.put(orgUuid, updated);

        const willBake = changed && !!PUBLISH_CONTACT_PAGE_FUNCTION_NAME;
        const publishId = await tryStartPublish(orgUuid, 'contact', willBake ? ['contact-page'] : []);

        if (willBake) {
            try {
                await lambdaClient.send(
                    new InvokeCommand({
                        FunctionName: PUBLISH_CONTACT_PAGE_FUNCTION_NAME,
                        InvocationType: 'Event',
                        Payload: JSON.stringify({
                            organisation_uuid: orgUuid,
                            publish_id: publishId,
                            page_key: 'contact',
                        }),
                    }),
                );
            } catch (error) {
                console.error(
                    'Failed to invoke publish-contact-page — Contact page published, but regeneration was not started',
                    error,
                );
                await markJobFailedToStart(orgUuid, 'contact', publishId, 'contact-page', startFailureReason(error));
            }
        }

        return updated;
    }
}
