import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { Service } from '@devyethiha/samjs';
import { markJobFailedToStart, startFailureReason, tryStartPublish } from './publish-status';
import type { TestimonialItem, TestimonialsContent, TestimonialsRecord } from '@sale-sync/shared/src/types';

// No hardcoded fallback: staging/prod are different tables, so an unset env var must fail loud.
// Read lazily so tests' env var setup is picked up.
function getTable(): string {
    const table = process.env.ORGANISATION_TABLE_NAME;
    if (!table) {
        throw new Error('ORGANISATION_TABLE_NAME environment variable is not set');
    }
    return table;
}

// Same cross-stack fire-and-forget invoke idiom as HomeService/SocialsService: the generator lives in
// ss/infra, a different SAM app/stack.
const lambdaClient = new LambdaClient({});

const EMPTY_RECORD: TestimonialsRecord = {
    data: null,
    draft: null,
    updated_at: new Date(0).toISOString(),
    published_at: null,
};

// Rating given to testimonials stored before ratings existed (decided in backlogs/testimonials-revamp).
const DEFAULT_RATING = 5;

export class NoDraftToPublishError extends Error {
    constructor() {
        super('No draft testimonials changes to publish');
        this.name = 'NoDraftToPublishError';
    }
}

// Stored content may still carry the four removed stat fields (averageRating, ...) and items without
// an id/rating. Only the testimonials list is normalised; any other stored keys are passed through so
// a record is never silently stripped just by being read (the published `data` keeps its legacy stat
// fields until the next publish, which the not-yet-redeployed client sites still render).
type StoredContent = Omit<TestimonialsContent, 'testimonials'> & {
    testimonials?: Array<Partial<TestimonialItem>>;
};

function normaliseContent(content: StoredContent | null): { content: TestimonialsContent | null; changed: boolean } {
    if (!content) {
        return { content: null, changed: false };
    }

    let changed = false;
    const testimonials = (content.testimonials ?? []).map((item) => {
        const id = item.id ?? randomUUID();
        const rating = item.rating ?? DEFAULT_RATING;
        if (item.id === undefined || item.rating === undefined) {
            changed = true;
        }
        return { ...item, id, rating } as TestimonialItem;
    });

    return { content: { ...content, testimonials } as TestimonialsContent, changed };
}

// Singleton per-org record, data/draft split, same publish semantics as before (draft left equal to the
// just-published value, not nulled). Whole-list draft and whole-list publish, like articles.
export class TestimonialsService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('testimonials');
        this.DB_Client = DB_Client;
    }

    // Singleton per-org record — PK=ORG#{orgUuid}, SK=TESTIMONIALS. Backfills `id` and `rating` on items
    // that predate them (in both `data` and `draft`) and writes the record back once, so item ids are
    // stable across reads (the web-app's edit routes depend on that).
    public async get(orgUuid: string): Promise<TestimonialsRecord> {
        const res = await this.DB_Client.send(
            new GetCommand({
                TableName: getTable(),
                Key: { PK: `ORG#${orgUuid}`, SK: 'TESTIMONIALS' },
            }),
        );

        if (!res.Item) {
            return EMPTY_RECORD;
        }

        const stored = JSON.parse(res.Item.data as string) as TestimonialsRecord;
        const data = normaliseContent(stored.data as StoredContent | null);
        const draft = normaliseContent(stored.draft as StoredContent | null);

        const record: TestimonialsRecord = { ...stored, data: data.content, draft: draft.content };
        if (data.changed || draft.changed) {
            await this.put(orgUuid, record);
        }
        return record;
    }

    private async put(orgUuid: string, record: TestimonialsRecord): Promise<void> {
        await this.DB_Client.send(
            new PutCommand({
                TableName: getTable(),
                Item: { PK: `ORG#${orgUuid}`, SK: 'TESTIMONIALS', data: JSON.stringify(record) },
            }),
        );
    }

    // Replaces the draft list. Rebuilds the draft as just { testimonials }, which drops the removed stat
    // fields from the org's draft.
    public async updateDraft(orgUuid: string, patch: { testimonials: TestimonialItem[] }): Promise<TestimonialsRecord> {
        const current = await this.get(orgUuid);

        const updated: TestimonialsRecord = {
            ...current,
            draft: { testimonials: patch.testimonials },
            updated_at: new Date().toISOString(),
        };

        await this.put(orgUuid, updated);
        return updated;
    }

    // Flips draft -> data, then fire-and-forget invokes infra/functions/publish-real-estate-home-page
    // with `testimonials_only`, so the home page bakes the testimonials without touching its Hero. Progress
    // is tracked under the 'home' publish-status key (the same generator and page the Hero uses), which
    // the web-app watches with watchPublish('home').
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

        const functionName = process.env.PUBLISH_REAL_ESTATE_HOME_PAGE_FUNCTION_NAME;
        const publishId = await tryStartPublish(orgUuid, 'home', functionName ? ['real-estate-home-page'] : []);

        if (functionName) {
            try {
                await lambdaClient.send(
                    new InvokeCommand({
                        FunctionName: functionName,
                        InvocationType: 'Event',
                        Payload: JSON.stringify({
                            organisation_uuid: orgUuid,
                            publish_id: publishId,
                            page_key: 'home',
                            testimonials_only: true,
                        }),
                    }),
                );
            } catch (error) {
                console.error(
                    'Failed to invoke publish-real-estate-home-page — testimonials published, but the home page was not re-baked',
                    error,
                );
                await markJobFailedToStart(orgUuid, 'home', publishId, 'real-estate-home-page', startFailureReason(error));
            }
        }

        return updated;
    }
}
