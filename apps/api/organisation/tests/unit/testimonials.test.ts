import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { UpdateTestimonialsDraftSchema } from '@sale-sync/shared';
import { NoDraftToPublishError, TestimonialsService } from '../../services/testimonials.service';

const mockLambdaSend = jest.fn<(command: any) => Promise<unknown>>(async () => ({}));
jest.mock('@aws-sdk/client-lambda', () => ({
    LambdaClient: jest.fn(() => ({ send: (command: any) => mockLambdaSend(command) })),
    InvokeCommand: jest.fn((input: any) => ({ input })),
}));
jest.mock('../../services/publish-status', () => ({
    tryStartPublish: jest.fn(async () => 'publish-1'),
    markJobFailedToStart: jest.fn(async () => undefined),
    startFailureReason: (error: unknown) => String(error),
}));

const ID_A = '6b8f3c1e-3a55-4d6e-9a0a-0f2f1d5b7c01';
const ID_B = '0c7d2a4b-8e9f-4a61-b5c3-2d4e6f8a9b02';

const item = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    name: 'Ploy S.',
    testimonial: 'Great agent',
    rating: 4,
    ...overrides,
});

describe('UpdateTestimonialsDraftSchema', () => {
    it('accepts a list and trims text', () => {
        const parsed = UpdateTestimonialsDraftSchema.parse({
            testimonials: [item(ID_A, { name: '  Ploy S.  ' })],
        });
        expect(parsed.testimonials[0].name).toBe('Ploy S.');
    });

    it('accepts an empty list (all testimonials removed)', () => {
        expect(UpdateTestimonialsDraftSchema.parse({ testimonials: [] })).toEqual({ testimonials: [] });
    });

    it('strips the removed stat fields instead of rejecting them', () => {
        const parsed = UpdateTestimonialsDraftSchema.parse({ averageRating: '4.9/5', happyTenants: '8,500+', testimonials: [] });
        expect(parsed).toEqual({ testimonials: [] });
    });

    it.each([0, 6, 3.5, -1, '4'])('rejects rating %s', (rating) => {
        expect(UpdateTestimonialsDraftSchema.safeParse({ testimonials: [item(ID_A, { rating })] }).success).toBe(false);
    });

    it('requires an id, a name and a text', () => {
        expect(UpdateTestimonialsDraftSchema.safeParse({ testimonials: [item('not-a-uuid')] }).success).toBe(false);
        expect(UpdateTestimonialsDraftSchema.safeParse({ testimonials: [item(ID_A, { name: ' ' })] }).success).toBe(false);
        expect(UpdateTestimonialsDraftSchema.safeParse({ testimonials: [item(ID_A, { testimonial: '' })] }).success).toBe(false);
    });

    it('rejects duplicate ids, missing list and more than 50 items', () => {
        expect(UpdateTestimonialsDraftSchema.safeParse({ testimonials: [item(ID_A), item(ID_A)] }).success).toBe(false);
        expect(UpdateTestimonialsDraftSchema.safeParse({}).success).toBe(false);
        const many = Array.from({ length: 51 }, (_, i) => item(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`));
        expect(UpdateTestimonialsDraftSchema.safeParse({ testimonials: many }).success).toBe(false);
    });
});

describe('TestimonialsService', () => {
    const originalTable = process.env.ORGANISATION_TABLE_NAME;
    let stored: string | undefined;
    let puts: number;
    let service: TestimonialsService;

    beforeEach(() => {
        process.env.ORGANISATION_TABLE_NAME = 'test-organisation';
        stored = undefined;
        puts = 0;
        const send = jest.fn(async (command: any) => {
            if (command.constructor.name === 'PutCommand') {
                stored = command.input.Item.data;
                puts++;
                return {};
            }
            return stored ? { Item: { data: stored } } : {};
        });
        service = new TestimonialsService({ send } as any);
    });

    afterEach(() => {
        process.env.ORGANISATION_TABLE_NAME = originalTable;
    });

    const seedLegacy = () => {
        const legacy = {
            averageRating: '4.9/5',
            happyTenants: '8,500+',
            verifiedListings: '5,000+',
            avgResponseTime: '24 h',
            testimonials: [{ name: 'Old A', testimonial: 'text a' }, { name: 'Old B', testimonial: 'text b' }],
        };
        stored = JSON.stringify({ data: legacy, draft: legacy, updated_at: '2026-08-29T00:00:00.000Z', published_at: '2026-08-29T00:00:00.000Z' });
    };

    it('returns an empty record when nothing is stored', async () => {
        const record = await service.get('org-1');
        expect(record.data).toBeNull();
        expect(record.draft).toBeNull();
        expect(puts).toBe(0);
    });

    it('backfills id and rating 5 on legacy items, writes back once, and keeps ids stable', async () => {
        seedLegacy();

        const first = await service.get('org-1');
        expect(puts).toBe(1);
        for (const list of [first.data!.testimonials, first.draft!.testimonials]) {
            expect(list).toHaveLength(2);
            for (const t of list) {
                expect(t.id).toMatch(/^[0-9a-f-]{36}$/);
                expect(t.rating).toBe(5);
            }
        }

        const second = await service.get('org-1');
        expect(puts).toBe(1);
        expect(second.draft!.testimonials.map((t) => t.id)).toEqual(first.draft!.testimonials.map((t) => t.id));
    });

    it('keeps the published legacy stat fields until the next publish', async () => {
        seedLegacy();
        const record = await service.get('org-1');
        expect((record.data as any).averageRating).toBe('4.9/5');
    });

    it('updateDraft replaces the list and drops the stat fields from the draft', async () => {
        seedLegacy();
        const updated = await service.updateDraft('org-1', { testimonials: [item(ID_A)] });

        expect(updated.draft).toEqual({ testimonials: [item(ID_A)] });
        expect(updated.data).not.toBeNull();
    });

    it('publish without a draft throws NoDraftToPublishError', async () => {
        await expect(service.publish('org-1')).rejects.toBeInstanceOf(NoDraftToPublishError);
    });

    describe('publish', () => {
        beforeEach(() => {
            mockLambdaSend.mockClear();
            process.env.PUBLISH_REAL_ESTATE_HOME_PAGE_FUNCTION_NAME = 'fn-home';
        });

        afterEach(() => {
            delete process.env.PUBLISH_REAL_ESTATE_HOME_PAGE_FUNCTION_NAME;
        });

        it('copies the draft to data and invokes the home generator with testimonials_only', async () => {
            await service.updateDraft('org-1', { testimonials: [item(ID_A), item(ID_B)] });
            const published = await service.publish('org-1');

            expect(published.data).toEqual({ testimonials: [item(ID_A), item(ID_B)] });
            expect(published.draft).toEqual(published.data);
            expect(published.published_at).not.toBeNull();

            expect(mockLambdaSend).toHaveBeenCalledTimes(1);
            const input = mockLambdaSend.mock.calls[0][0].input;
            expect(input.FunctionName).toBe('fn-home');
            expect(input.InvocationType).toBe('Event');
            expect(JSON.parse(input.Payload)).toEqual({
                organisation_uuid: 'org-1',
                publish_id: 'publish-1',
                page_key: 'home',
                testimonials_only: true,
            });
        });

        it('publishes an empty list too (the generator hides the section)', async () => {
            await service.updateDraft('org-1', { testimonials: [] });
            const published = await service.publish('org-1');
            expect(published.data).toEqual({ testimonials: [] });
            expect(mockLambdaSend).toHaveBeenCalledTimes(1);
        });

        it('still publishes when the invoke fails', async () => {
            mockLambdaSend.mockRejectedValueOnce(new Error('boom'));
            await service.updateDraft('org-1', { testimonials: [item(ID_A)] });
            const published = await service.publish('org-1');
            expect(published.data?.testimonials).toHaveLength(1);
        });

        it('does not invoke when the function name env var is unset', async () => {
            delete process.env.PUBLISH_REAL_ESTATE_HOME_PAGE_FUNCTION_NAME;
            await service.updateDraft('org-1', { testimonials: [item(ID_A)] });
            await service.publish('org-1');
            expect(mockLambdaSend).not.toHaveBeenCalled();
        });
    });

    it('fails loud when the table env var is unset', async () => {
        delete process.env.ORGANISATION_TABLE_NAME;
        await expect(service.get('org-1')).rejects.toThrow('ORGANISATION_TABLE_NAME');
    });
});
