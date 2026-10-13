import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { UpdateContactDraftSchema } from '@sale-sync/shared';

const mockLambdaSend = jest.fn<(command: any) => Promise<unknown>>(async () => ({}));
jest.mock('@aws-sdk/client-lambda', () => ({
    LambdaClient: jest.fn(() => ({ send: (command: any) => mockLambdaSend(command) })),
    InvokeCommand: jest.fn((input: any) => ({ input })),
}));
const mockTryStartPublish = jest.fn<(org: string, page: string, expected: string[]) => Promise<string>>(
    async () => 'publish-1',
);
jest.mock('../../services/publish-status', () => ({
    tryStartPublish: (org: string, page: string, expected: string[]) => mockTryStartPublish(org, page, expected),
    markJobFailedToStart: jest.fn(async () => undefined),
    startFailureReason: (error: unknown) => String(error),
}));

const info = { email: 'hello@example.com', phone: '+66 964206877', address: 'Watthana, Bangkok' };

describe('UpdateContactDraftSchema', () => {
    it('accepts every field independently', () => {
        expect(UpdateContactDraftSchema.safeParse({ title: 'Contact Us' }).success).toBe(true);
        expect(UpdateContactDraftSchema.safeParse({ businessInfo: info }).success).toBe(true);
        expect(UpdateContactDraftSchema.safeParse({ seo: { title: 'Contact' } }).success).toBe(true);
    });

    it('accepts empty business info fields (an org may have no public phone)', () => {
        expect(
            UpdateContactDraftSchema.safeParse({ businessInfo: { email: '', phone: '', address: '' } }).success,
        ).toBe(true);
    });

    it('rejects a malformed email and over-long fields', () => {
        expect(UpdateContactDraftSchema.safeParse({ businessInfo: { ...info, email: 'nope' } }).success).toBe(false);
        expect(UpdateContactDraftSchema.safeParse({ title: 'a'.repeat(201) }).success).toBe(false);
        expect(UpdateContactDraftSchema.safeParse({ subtitle: 'a'.repeat(401) }).success).toBe(false);
        expect(UpdateContactDraftSchema.safeParse({ businessInfo: { ...info, phone: '1'.repeat(41) } }).success).toBe(
            false,
        );
    });
});

describe('ContactService', () => {
    const originalTable = process.env.ORGANISATION_TABLE_NAME;
    let stored: string | undefined;
    let service: any;
    let NoDraftToPublishError: any;

    beforeEach(() => {
        process.env.ORGANISATION_TABLE_NAME = 'test-organisation';
        process.env.PUBLISH_CONTACT_PAGE_FUNCTION_NAME = 'publish-contact-page-fn';
        mockLambdaSend.mockClear();
        mockTryStartPublish.mockClear();
        stored = undefined;
        const send = jest.fn(async (command: any) => {
            if (command.constructor.name === 'PutCommand') {
                stored = command.input.Item.data;
                return {};
            }
            return stored ? { Item: { data: stored } } : {};
        });
        // The function name is read at module load, so load the service after setting the env var.
        jest.isolateModules(() => {
            const mod = require('../../services/contact.service');
            service = new mod.ContactService({ send } as any);
            NoDraftToPublishError = mod.NoDraftToPublishError;
        });
    });

    afterEach(() => {
        process.env.ORGANISATION_TABLE_NAME = originalTable;
        delete process.env.PUBLISH_CONTACT_PAGE_FUNCTION_NAME;
    });

    it('returns an empty record when nothing is stored', async () => {
        const record = await service.get('org-1');
        expect(record.data).toBeNull();
        expect(record.draft).toBeNull();
    });

    it('merges patches field by field', async () => {
        await service.updateDraft('org-1', { title: 'Contact Us' });
        const updated = await service.updateDraft('org-1', { businessInfo: info });
        expect(updated.draft).toMatchObject({ title: 'Contact Us', businessInfo: info });
        expect(updated.data).toBeNull();
    });

    it('publish without a draft throws NoDraftToPublishError', async () => {
        await expect(service.publish('org-1')).rejects.toBeInstanceOf(NoDraftToPublishError);
    });

    it('publish copies draft to data, keeps the draft and invokes the generator', async () => {
        await service.updateDraft('org-1', { title: 'Contact Us' });
        const published = await service.publish('org-1');

        expect(published.data?.title).toBe('Contact Us');
        expect(published.draft).toEqual(published.data);
        expect(mockTryStartPublish).toHaveBeenCalledWith('org-1', 'contact', ['contact-page']);
        expect(mockLambdaSend).toHaveBeenCalledTimes(1);
        expect(JSON.parse(mockLambdaSend.mock.calls[0][0].input.Payload)).toEqual({
            organisation_uuid: 'org-1',
            publish_id: 'publish-1',
            page_key: 'contact',
        });
    });

    it('bakes on an SEO-only change', async () => {
        await service.updateDraft('org-1', { title: 'Contact Us' });
        await service.publish('org-1');
        mockLambdaSend.mockClear();

        await service.updateDraft('org-1', { seo: { title: 'Contact | Acme' } });
        await service.publish('org-1');
        expect(mockLambdaSend).toHaveBeenCalledTimes(1);
    });

    it('does not bake when nothing changed, unless rebake is forced', async () => {
        await service.updateDraft('org-1', { title: 'Contact Us' });
        await service.publish('org-1');
        mockLambdaSend.mockClear();

        await service.publish('org-1');
        expect(mockLambdaSend).not.toHaveBeenCalled();
        expect(mockTryStartPublish).toHaveBeenLastCalledWith('org-1', 'contact', []);

        await service.publish('org-1', { rebake: true });
        expect(mockLambdaSend).toHaveBeenCalledTimes(1);
    });
});
