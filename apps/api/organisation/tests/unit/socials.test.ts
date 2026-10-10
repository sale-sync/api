import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { UpdateSocialsDraftSchema } from '@sale-sync/shared';
import { NoDraftToPublishError, SocialsService } from '../../services/socials.service';

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

describe('UpdateSocialsDraftSchema', () => {
    it('accepts http(s) urls and trims them', () => {
        const parsed = UpdateSocialsDraftSchema.parse({
            facebook: '  https://facebook.com/acme  ',
            whatsapp: 'https://wa.me/66812345678',
            line: 'http://line.me/ti/p/@acme',
        });
        expect(parsed.facebook).toBe('https://facebook.com/acme');
        expect(parsed.whatsapp).toBe('https://wa.me/66812345678');
    });

    it('accepts an empty string, which clears a network', () => {
        expect(UpdateSocialsDraftSchema.parse({ x: '' })).toEqual({ x: '' });
    });

    it.each(['javascript:alert(1)', 'data:text/html,hi', 'ftp://example.com', 'not a url', 'facebook.com/acme'])(
        'rejects %s',
        (value) => {
            expect(UpdateSocialsDraftSchema.safeParse({ facebook: value }).success).toBe(false);
        },
    );

    it('rejects an empty body and unknown networks', () => {
        expect(UpdateSocialsDraftSchema.safeParse({}).success).toBe(false);
        expect(UpdateSocialsDraftSchema.safeParse({ linkedin: 'https://linkedin.com/in/a' }).success).toBe(false);
    });

    it('rejects urls over 2048 characters', () => {
        expect(UpdateSocialsDraftSchema.safeParse({ youtube: `https://youtube.com/${'a'.repeat(2048)}` }).success).toBe(
            false,
        );
    });
});

describe('SocialsService', () => {
    const originalTable = process.env.ORGANISATION_TABLE_NAME;
    let stored: string | undefined;
    let service: SocialsService;

    beforeEach(() => {
        process.env.ORGANISATION_TABLE_NAME = 'test-organisation';
        stored = undefined;
        const send = jest.fn(async (command: any) => {
            if (command.constructor.name === 'PutCommand') {
                stored = command.input.Item.data;
                return {};
            }
            return stored ? { Item: { data: stored } } : {};
        });
        service = new SocialsService({ send } as any);
    });

    afterEach(() => {
        process.env.ORGANISATION_TABLE_NAME = originalTable;
    });

    it('returns an empty record when nothing is stored', async () => {
        const record = await service.get('org-1');
        expect(record.data).toBeNull();
        expect(record.draft).toBeNull();
    });

    it('fills every network in the draft and only changes the patched ones', async () => {
        await service.updateDraft('org-1', { facebook: 'https://facebook.com/acme' });
        const updated = await service.updateDraft('org-1', { x: 'https://x.com/acme' });

        expect(updated.draft).toEqual({
            facebook: 'https://facebook.com/acme',
            instagram: '',
            line: '',
            whatsapp: '',
            youtube: '',
            tiktok: '',
            x: 'https://x.com/acme',
        });
        expect(updated.data).toBeNull();
    });

    it('clears a network with an empty string', async () => {
        await service.updateDraft('org-1', { facebook: 'https://facebook.com/acme' });
        const updated = await service.updateDraft('org-1', { facebook: '' });
        expect(updated.draft?.facebook).toBe('');
    });

    it('publish copies draft to data and keeps the draft', async () => {
        await service.updateDraft('org-1', { line: 'https://line.me/ti/p/@acme' });
        const published = await service.publish('org-1');

        expect(published.data?.line).toBe('https://line.me/ti/p/@acme');
        expect(published.draft).toEqual(published.data);
        expect(published.published_at).not.toBeNull();
    });

    it('publish without a draft throws NoDraftToPublishError', async () => {
        await expect(service.publish('org-1')).rejects.toBeInstanceOf(NoDraftToPublishError);
    });

    it('fails loud when the table env var is unset', async () => {
        delete process.env.ORGANISATION_TABLE_NAME;
        await expect(service.get('org-1')).rejects.toThrow('ORGANISATION_TABLE_NAME');
    });

    describe('publish fan-out', () => {
        const ENV = [
            'PUBLISH_REAL_ESTATE_HOME_PAGE_FUNCTION_NAME',
            'PUBLISH_FAQ_PAGE_FUNCTION_NAME',
            'PUBLISH_ARTICLE_DETAIL_PAGE_FUNCTION_NAME',
            'PUBLISH_BLOCKNOTE_SINGLETON_FUNCTION_NAME',
            'PUBLISH_PROPERTY_DETAIL_PAGE_FUNCTION_NAME',
        ];

        beforeEach(() => {
            mockLambdaSend.mockClear();
            for (const name of ENV) process.env[name] = `fn-${name}`;
        });

        afterEach(() => {
            for (const name of ENV) delete process.env[name];
        });

        const payloads = () =>
            mockLambdaSend.mock.calls.map(([command]) => ({
                fn: command.input.FunctionName as string,
                body: JSON.parse(command.input.Payload as string) as Record<string, unknown>,
            }));

        it('invokes each configured generator with footer_only and the shared publish id', async () => {
            await service.updateDraft('org-1', { facebook: 'https://facebook.com/acme' });
            await service.publish('org-1');

            const calls = payloads();
            // home, faq, article-detail, 3 blocknote pages, property-detail
            expect(calls).toHaveLength(7);

            const home = calls.find((c) => c.fn === 'fn-PUBLISH_REAL_ESTATE_HOME_PAGE_FUNCTION_NAME')!;
            expect(home.body).toEqual({
                organisation_uuid: 'org-1',
                publish_id: 'publish-1',
                page_key: 'socials',
                footer_only: true,
            });

            const detail = calls.find((c) => c.fn === 'fn-PUBLISH_ARTICLE_DETAIL_PAGE_FUNCTION_NAME')!;
            expect(detail.body).toMatchObject({ added_or_changed_slugs: [], removed_slugs: [] });

            const pages = calls
                .filter((c) => c.fn === 'fn-PUBLISH_BLOCKNOTE_SINGLETON_FUNCTION_NAME')
                .map((c) => c.body.page);
            expect(pages.sort()).toEqual(['about', 'privacy-policy', 'terms-and-conditions']);

            const property = calls.find((c) => c.fn === 'fn-PUBLISH_PROPERTY_DETAIL_PAGE_FUNCTION_NAME')!;
            expect(property.body).toEqual({ organisation_uuid: 'org-1', footer_only: true });
        });

        it('skips generators whose function name env var is unset', async () => {
            delete process.env.PUBLISH_FAQ_PAGE_FUNCTION_NAME;
            await service.updateDraft('org-1', { x: 'https://x.com/acme' });
            await service.publish('org-1');

            expect(payloads().some((c) => c.fn === 'fn-PUBLISH_FAQ_PAGE_FUNCTION_NAME')).toBe(false);
        });

        it('still publishes when a generator invoke fails', async () => {
            mockLambdaSend.mockRejectedValueOnce(new Error('boom'));
            await service.updateDraft('org-1', { x: 'https://x.com/acme' });
            const published = await service.publish('org-1');

            expect(published.data?.x).toBe('https://x.com/acme');
        });
    });
});
