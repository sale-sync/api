import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import type { TestimonialItem, TestimonialsContent, TestimonialsRecord } from '@sale-sync/shared/src/types';

const TABLE = process.env.ORGANISATION_TABLE_NAME || 'sale-sync-organisation';

const EMPTY_RECORD: TestimonialsRecord = {
    data: null,
    draft: null,
    updated_at: new Date(0).toISOString(),
    published_at: null,
};

export class NoDraftToPublishError extends Error {
    constructor() {
        super('No draft testimonials changes to publish');
        this.name = 'NoDraftToPublishError';
    }
}

// Mirrors BrandingService exactly — singleton per-org record, data/draft split, same publish
// semantics (draft left equal to the just-published value, not nulled).
export class TestimonialsService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('testimonials');
        this.DB_Client = DB_Client;
    }

    // Singleton per-org record — PK=ORG#{orgUuid}, SK=TESTIMONIALS.
    public async get(orgUuid: string): Promise<TestimonialsRecord> {
        const res = await this.DB_Client.send(
            new GetCommand({
                TableName: TABLE,
                Key: { PK: `ORG#${orgUuid}`, SK: 'TESTIMONIALS' },
            }),
        );

        return res.Item ? (JSON.parse(res.Item.data as string) as TestimonialsRecord) : EMPTY_RECORD;
    }

    private async put(orgUuid: string, record: TestimonialsRecord): Promise<void> {
        await this.DB_Client.send(
            new PutCommand({
                TableName: TABLE,
                Item: { PK: `ORG#${orgUuid}`, SK: 'TESTIMONIALS', data: JSON.stringify(record) },
            }),
        );
    }

    public async updateDraft(
        orgUuid: string,
        patch: {
            averageRating?: string;
            happyTenants?: string;
            verifiedListings?: string;
            avgResponseTime?: string;
            testimonials?: TestimonialItem[];
        },
    ): Promise<TestimonialsRecord> {
        const current = await this.get(orgUuid);
        const currentDraft: TestimonialsContent = current.draft ?? {
            averageRating: '',
            happyTenants: '',
            verifiedListings: '',
            avgResponseTime: '',
            testimonials: [],
        };

        const updatedDraft: TestimonialsContent = {
            ...currentDraft,
            ...(patch.averageRating !== undefined && { averageRating: patch.averageRating }),
            ...(patch.happyTenants !== undefined && { happyTenants: patch.happyTenants }),
            ...(patch.verifiedListings !== undefined && { verifiedListings: patch.verifiedListings }),
            ...(patch.avgResponseTime !== undefined && { avgResponseTime: patch.avgResponseTime }),
            ...(patch.testimonials !== undefined && { testimonials: patch.testimonials }),
        };

        const updated: TestimonialsRecord = {
            ...current,
            draft: updatedDraft,
            updated_at: new Date().toISOString(),
        };

        await this.put(orgUuid, updated);
        return updated;
    }

    // Flips draft -> data. Leaves `draft` equal to the just-published value (not nulled), same
    // rationale as BrandingService.publish.
    public async publish(orgUuid: string): Promise<TestimonialsRecord> {
        const current = await this.get(orgUuid);
        if (!current.draft) {
            throw new NoDraftToPublishError();
        }

        const updated: TestimonialsRecord = {
            ...current,
            data: current.draft,
            published_at: new Date().toISOString(),
        };

        await this.put(orgUuid, updated);
        return updated;
    }
}
