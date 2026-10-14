import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import {
    ContactFormFieldSchema,
    DEFAULT_CONTACT_FORM_FIELDS,
    ListContactSubmissionsQuerySchema,
    UpdateContactFormSchema,
} from '@sale-sync/shared';
import type { ContactSubmission } from '@sale-sync/shared/src/types';
// organisation.service.ts pulls in the ESM-only `uuid` package, which this jest setup cannot load;
// the controllers only need its InsufficientRoleError class and (as a type) OrganisationService.
jest.mock('../../services/organisation.service', () => {
    class InsufficientRoleError extends Error {}
    class OrganisationService {}
    return { InsufficientRoleError, OrganisationService };
});

import { ContactFormService } from '../../services/contact-form.service';
import { InboxService, SubmissionNotFoundError } from '../../services/inbox.service';
import { InsufficientRoleError } from '../../services/organisation.service';
import ContactFormController from '../../contact-form/contact-form.controller';
import InboxController from '../../inbox/inbox.controller';

// A small in-memory stand-in for the organisation table: enough of Get/Put/Delete/Query to exercise
// the real key conditions, ordering, cursors and filters the services send. `pageSize` caps how many
// items one Query reads (before filtering), the way DynamoDB's 1 MB page does, so multi-page reads
// are actually exercised.
type Item = Record<string, any>;

function fakeTable(pageSize = 1000) {
    const items = new Map<string, Item>();
    const k = (key: Item) => `${key.PK}|${key.SK}`;
    const conditionFailed = () => Object.assign(new Error('conditional'), { name: 'ConditionalCheckFailedException' });

    const send = jest.fn(async (command: any): Promise<any> => {
        const input = command.input;
        switch (command.constructor.name) {
            case 'GetCommand':
                return { Item: items.get(k(input.Key)) };
            case 'PutCommand':
                if (input.ConditionExpression === 'attribute_exists(PK)' && !items.has(k(input.Item))) {
                    throw conditionFailed();
                }
                items.set(k(input.Item), input.Item);
                return {};
            case 'DeleteCommand':
                if (!items.has(k(input.Key))) throw conditionFailed();
                items.delete(k(input.Key));
                return {};
            case 'QueryCommand': {
                const values = input.ExpressionAttributeValues;
                let rows = [...items.values()]
                    .filter((item) => item.PK === values[':pk'] && String(item.SK).startsWith(values[':sk']))
                    .sort((a, b) => (a.SK < b.SK ? 1 : -1)); // ScanIndexForward: false
                expect(input.ScanIndexForward === false || input.Select === 'COUNT').toBe(true);
                if (input.ExclusiveStartKey) rows = rows.filter((item) => item.SK < input.ExclusiveStartKey.SK);

                const read = rows.slice(0, Math.min(pageSize, input.Limit ?? pageSize));
                const last = read[read.length - 1];
                const more = rows.length > read.length;
                const matched = read.filter((item) => {
                    if (input.FilterExpression === 'contains(search_text, :q)') {
                        return String(item.search_text).includes(values[':q']);
                    }
                    if (input.FilterExpression === 'is_read = :read') return item.is_read === values[':read'];
                    return true;
                });
                return {
                    Items: input.Select === 'COUNT' ? undefined : matched,
                    Count: matched.length,
                    LastEvaluatedKey: more && last ? { PK: last.PK, SK: last.SK } : undefined,
                };
            }
            default:
                throw new Error(`unexpected command ${command.constructor.name}`);
        }
    });

    // Mirrors what mutation-api's ContactSubmissionService.create() writes.
    function seed(orgUuid: string, minute: number, text: string, read = false): string {
        const submittedAt = `2026-10-14T10:${String(minute).padStart(2, '0')}:00.000Z`;
        const id = `${submittedAt}_00000000-0000-4000-8000-${String(minute).padStart(12, '0')}`;
        const submission: ContactSubmission = {
            id,
            org_uuid: orgUuid,
            submitted_at: submittedAt,
            read,
            values: [{ field_id: 'description', label: 'Description', type: 'textarea', value: text }],
        };
        items.set(`ORG#${orgUuid}|CONTACT_SUBMISSION#${id}`, {
            PK: `ORG#${orgUuid}`,
            SK: `CONTACT_SUBMISSION#${id}`,
            data: JSON.stringify(submission),
            is_read: read,
            search_text: text.toLowerCase(),
        });
        return id;
    }

    return { send, seed, items };
}

beforeEach(() => {
    process.env.ORGANISATION_TABLE_NAME = 'test-organisation';
});

describe('UpdateContactFormSchema', () => {
    it('accepts the default form and every field type', () => {
        expect(UpdateContactFormSchema.safeParse({ fields: DEFAULT_CONTACT_FORM_FIELDS }).success).toBe(true);
        for (const type of ['phone', 'email', 'textarea', 'price']) {
            expect(ContactFormFieldSchema.safeParse({ id: 'f', type, label: 'F', required: false }).success).toBe(true);
        }
        for (const inputType of ['string', 'number']) {
            expect(
                ContactFormFieldSchema.safeParse({ id: 'f', type: 'text', inputType, label: 'F', required: true })
                    .success,
            ).toBe(true);
        }
    });

    it('rejects unknown types, a text field without inputType and a select without unique, non-empty options', () => {
        const base = { id: 'f', label: 'F', required: false };
        expect(ContactFormFieldSchema.safeParse({ ...base, type: 'checkbox' }).success).toBe(false);
        expect(ContactFormFieldSchema.safeParse({ ...base, type: 'text' }).success).toBe(false);
        expect(ContactFormFieldSchema.safeParse({ ...base, type: 'select', options: [] }).success).toBe(false);
        expect(ContactFormFieldSchema.safeParse({ ...base, type: 'select', options: ['A', 'A'] }).success).toBe(false);
        expect(ContactFormFieldSchema.safeParse({ ...base, type: 'select', options: ['A', ' '] }).success).toBe(false);
    });

    it('rejects an empty form, duplicate field ids, a blank label and too many fields', () => {
        const field = (id: string) => ({ id, type: 'email', label: 'Email', required: false });
        expect(UpdateContactFormSchema.safeParse({ fields: [] }).success).toBe(false);
        expect(UpdateContactFormSchema.safeParse({ fields: [field('a'), field('a')] }).success).toBe(false);
        expect(UpdateContactFormSchema.safeParse({ fields: [{ ...field('a'), label: '  ' }] }).success).toBe(false);
        expect(UpdateContactFormSchema.safeParse({ fields: [{ ...field('a'), id: '1 bad' }] }).success).toBe(false);
        expect(UpdateContactFormSchema.safeParse({ fields: [{ ...field('a'), id: 'constructor' }] }).success).toBe(
            false,
        );
        expect(
            UpdateContactFormSchema.safeParse({ fields: Array.from({ length: 21 }, (_, i) => field(`f${i}`)) }).success,
        ).toBe(false);
    });
});

describe('ListContactSubmissionsQuerySchema', () => {
    it('defaults the limit and rejects an out-of-range limit or a malformed cursor', () => {
        expect(ListContactSubmissionsQuerySchema.parse({}).limit).toBe(20);
        expect(ListContactSubmissionsQuerySchema.parse({ limit: '5' }).limit).toBe(5);
        expect(ListContactSubmissionsQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
        expect(ListContactSubmissionsQuerySchema.safeParse({ cursor: 'META#other-org' }).success).toBe(false);
    });
});

describe('ContactFormService', () => {
    it('returns the default form until the org saves one, and keeps each org separate', async () => {
        const table = fakeTable();
        const service = new ContactFormService({ send: table.send } as any);

        expect(await service.get('org-a')).toEqual({ fields: DEFAULT_CONTACT_FORM_FIELDS, updated_at: null });

        const fields = [{ id: 'mail', type: 'email' as const, label: 'Your email', required: true }];
        const saved = await service.save('org-a', fields);
        expect(saved.updated_at).not.toBeNull();

        expect((await service.get('org-a')).fields).toEqual(fields);
        // Org B never saved anything: still the default, not org A's form.
        expect((await service.get('org-b')).fields).toEqual(DEFAULT_CONTACT_FORM_FIELDS);
        expect([...table.items.keys()]).toEqual(['ORG#org-a|CONTACT_FORM']);
    });
});

describe('InboxService', () => {
    it('lists newest first and pages with the cursor, keeping that order across pages', async () => {
        const table = fakeTable();
        const service = new InboxService({ send: table.send } as any);
        for (let minute = 1; minute <= 5; minute++) table.seed('org-a', minute, `message ${minute}`);

        const first = await service.list('org-a', { limit: 2 });
        expect(first.items.map((item) => item.values[0].value)).toEqual(['message 5', 'message 4']);
        expect(first.next_cursor).toBe(first.items[1].id);

        const second = await service.list('org-a', { limit: 2, cursor: first.next_cursor! });
        expect(second.items.map((item) => item.values[0].value)).toEqual(['message 3', 'message 2']);

        const third = await service.list('org-a', { limit: 2, cursor: second.next_cursor! });
        expect(third.items.map((item) => item.values[0].value)).toEqual(['message 1']);
        expect(third.next_cursor).toBeNull();
    });

    it("never returns, counts, marks or deletes another organisation's submissions", async () => {
        const table = fakeTable();
        const service = new InboxService({ send: table.send } as any);
        table.seed('org-a', 1, 'for org a');
        const idB = table.seed('org-b', 2, 'for org b');

        const listA = await service.list('org-a', { limit: 20 });
        expect(listA.items.map((item) => item.org_uuid)).toEqual(['org-a']);
        expect((await service.list('org-a', { limit: 20, q: 'org b' })).items).toEqual([]);
        expect(await service.countUnread('org-a')).toBe(1);
        expect(await service.countUnread('org-c')).toBe(0);

        // Org A knows org B's submission id, and still cannot touch it.
        await expect(service.setRead('org-a', idB, true)).rejects.toBeInstanceOf(SubmissionNotFoundError);
        await expect(service.delete('org-a', idB)).rejects.toBeInstanceOf(SubmissionNotFoundError);
        expect((await service.list('org-b', { limit: 20 })).items[0]).toMatchObject({ id: idB, read: false });
    });

    it('searches free text case-insensitively across the whole inbox, reading as many pages as it takes', async () => {
        const table = fakeTable(3); // 3 items per read, so the 2 matches are several reads apart
        const service = new InboxService({ send: table.send } as any);
        for (let minute = 1; minute <= 12; minute++) {
            table.seed('org-a', minute, minute === 2 || minute === 11 ? `Looking for a CONDO ${minute}` : 'hello');
        }

        const result = await service.list('org-a', { limit: 20, q: 'Condo' });

        expect(result.items.map((item) => item.values[0].value)).toEqual([
            'Looking for a CONDO 11',
            'Looking for a CONDO 2',
        ]);
        expect(result.next_cursor).toBeNull();
        expect(table.send.mock.calls.length).toBeGreaterThan(1);
    });

    it('stops a search after its page budget and hands back a cursor to continue from', async () => {
        const table = fakeTable(1);
        const service = new InboxService({ send: table.send } as any);
        for (let minute = 1; minute <= 15; minute++) table.seed('org-a', minute, minute === 1 ? 'needle' : 'hay');

        const first = await service.list('org-a', { limit: 20, q: 'needle' });
        expect(first.items).toEqual([]);
        expect(first.next_cursor).not.toBeNull();
        expect(table.send).toHaveBeenCalledTimes(10);

        const second = await service.list('org-a', { limit: 20, q: 'needle', cursor: first.next_cursor! });
        expect(second.items.map((item) => item.values[0].value)).toEqual(['needle']);
    });

    it('marks read/unread, keeping the stored record and the filter attribute in step', async () => {
        const table = fakeTable();
        const service = new InboxService({ send: table.send } as any);
        const id = table.seed('org-a', 1, 'one');
        table.seed('org-a', 2, 'two');

        expect(await service.countUnread('org-a')).toBe(2);
        expect((await service.setRead('org-a', id, true)).read).toBe(true);
        expect(await service.countUnread('org-a')).toBe(1);

        const stored = table.items.get(`ORG#org-a|CONTACT_SUBMISSION#${id}`)!;
        expect(stored.is_read).toBe(true);
        expect(JSON.parse(stored.data).read).toBe(true);
        expect(stored.search_text).toBe('one'); // untouched

        await service.setRead('org-a', id, false);
        expect(await service.countUnread('org-a')).toBe(2);
    });

    it('deletes a submission, and reports a missing one instead of recreating it', async () => {
        const table = fakeTable();
        const service = new InboxService({ send: table.send } as any);
        const id = table.seed('org-a', 1, 'one');

        await service.delete('org-a', id);
        expect(table.items.size).toBe(0);

        await expect(service.delete('org-a', id)).rejects.toBeInstanceOf(SubmissionNotFoundError);
        await expect(service.setRead('org-a', id, true)).rejects.toBeInstanceOf(SubmissionNotFoundError);
        expect(table.items.size).toBe(0);
    });
});

// Controllers: the auth guards, where the organisation comes from, and the role gates.
function jwt(payload: Record<string, unknown>): string {
    const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    return `${part({ alg: 'none' })}.${part(payload)}.sig`;
}

function event(
    method: string,
    options: { org?: string; signedIn?: boolean; query?: Record<string, string>; body?: unknown } = {},
): APIGatewayProxyEvent {
    const cookies: string[] = [];
    if (options.signedIn !== false) cookies.push('Authentication=token', `Identifier=${jwt({ sub: 'user-1' })}`);
    if (options.org) {
        cookies.push(`Organisation=${jwt({ organisation_id: 'slug', user_id: 'user-1', uuid: options.org })}`);
    }
    return {
        httpMethod: method,
        path: '/organisations/inbox',
        headers: cookies.length ? { cookie: cookies.join('; ') } : {},
        queryStringParameters: options.query ?? null,
        body: options.body === undefined ? null : JSON.stringify(options.body),
    } as unknown as APIGatewayProxyEvent;
}

// The caller ('user-1') is a member of org-a and org-b only.
function organisationService(canManage: boolean) {
    return {
        getMembership: jest.fn(async (orgUuid: string, userId: string) =>
            ['org-a', 'org-b'].includes(orgUuid) && userId === 'user-1' ? { role: 'member' } : null,
        ),
        assertCanManageTeam: jest.fn(async () => {
            if (!canManage) throw new InsufficientRoleError();
        }),
    } as any;
}

describe('InboxController', () => {
    function setup(canManage = true) {
        const table = fakeTable();
        const controller = new InboxController(
            organisationService(canManage),
            new InboxService({ send: table.send } as any),
        );
        return { table, controller };
    }

    it('rejects a caller who is not signed in or has no organisation, on every method', async () => {
        const { table, controller } = setup();
        const id = table.seed('org-a', 1, 'one');

        for (const method of ['get', 'patch', 'delete'] as const) {
            expect((await controller[method](event(method, { signedIn: false, query: { id } }))).statusCode).toBe(401);
            expect((await controller[method](event(method, { query: { id } }))).statusCode).toBe(404);
        }
        expect(table.items.size).toBe(1);
    });

    it('refuses (403) a caller whose session names an organisation they are not a member of', async () => {
        const { table, controller } = setup();
        const id = table.seed('org-x', 1, 'private');

        // Knowing another organisation's uuid (it is not secret) must not be enough to read its inbox.
        const list = await controller.get(event('get', { org: 'org-x' }));
        expect(list.statusCode).toBe(403);
        expect(list.body).not.toContain('private');
        expect((await controller.get(event('get', { org: 'org-x', query: { summary: 'true' } }))).statusCode).toBe(403);
        expect(
            (await controller.patch(event('patch', { org: 'org-x', query: { id }, body: { read: true } }))).statusCode,
        ).toBe(403);
        expect((await controller.delete(event('delete', { org: 'org-x', query: { id } }))).statusCode).toBe(403);
        expect(table.items.size).toBe(1);
    });

    it('treats a malformed Organisation cookie as no organisation, and malformed JSON as a 400', async () => {
        const { table, controller } = setup();
        const id = table.seed('org-a', 1, 'one');

        const badCookie = event('get', { org: 'org-a' });
        badCookie.headers.cookie = badCookie.headers.cookie!.replace(/Organisation=[^;]+/, 'Organisation=not-a-jwt');
        expect((await controller.get(badCookie)).statusCode).toBe(404);

        const badJson = { ...event('patch', { org: 'org-a', query: { id } }), body: '{nope' };
        expect((await controller.patch(badJson)).statusCode).toBe(400);
    });

    it("lists only the caller's organisation, whatever the query string says", async () => {
        const { table, controller } = setup();
        table.seed('org-a', 1, 'for a');
        table.seed('org-b', 2, 'for b');

        const res = await controller.get(event('get', { org: 'org-a', query: { uuid: 'org-b', org_uuid: 'org-b' } }));

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).items.map((item: ContactSubmission) => item.org_uuid)).toEqual(['org-a']);
    });

    it('returns the unread count for ?summary=true, searches with ?q= and 400s on a bad limit', async () => {
        const { table, controller } = setup();
        table.seed('org-a', 1, 'pool villa');
        table.seed('org-a', 2, 'condo', true);

        const summary = await controller.get(event('get', { org: 'org-a', query: { summary: 'true' } }));
        expect(JSON.parse(summary.body)).toEqual({ unread: 1 });

        const search = await controller.get(event('get', { org: 'org-a', query: { q: 'VILLA' } }));
        expect(JSON.parse(search.body).items).toHaveLength(1);

        expect((await controller.get(event('get', { org: 'org-a', query: { limit: '0' } }))).statusCode).toBe(400);
    });

    it("marks a submission read, 404s on another organisation's id and 400s on a malformed id or body", async () => {
        const { table, controller } = setup();
        const id = table.seed('org-a', 1, 'one');
        const idB = table.seed('org-b', 2, 'two');

        const ok = await controller.patch(event('patch', { org: 'org-a', query: { id }, body: { read: true } }));
        expect(ok.statusCode).toBe(200);
        expect(JSON.parse(ok.body).read).toBe(true);

        const other = await controller.patch(event('patch', { org: 'org-a', query: { id: idB }, body: { read: true } }));
        expect(other.statusCode).toBe(404);

        const badId = await controller.patch(
            event('patch', { org: 'org-a', query: { id: 'CONTACT_FORM' }, body: { read: true } }),
        );
        expect(badId.statusCode).toBe(400);
        const badBody = await controller.patch(event('patch', { org: 'org-a', query: { id }, body: { read: 'yes' } }));
        expect(badBody.statusCode).toBe(400);
    });

    it('lets only an owner/admin delete', async () => {
        const member = setup(false);
        const id = member.table.seed('org-a', 1, 'one');
        const denied = await member.controller.delete(event('delete', { org: 'org-a', query: { id } }));
        expect(denied.statusCode).toBe(403);
        expect(member.table.items.size).toBe(1);

        const admin = setup(true);
        const id2 = admin.table.seed('org-a', 1, 'one');
        expect((await admin.controller.delete(event('delete', { org: 'org-a', query: { id: id2 } }))).statusCode).toBe(204);
        expect(admin.table.items.size).toBe(0);
        expect((await admin.controller.delete(event('delete', { org: 'org-a', query: { id: id2 } }))).statusCode).toBe(404);
    });
});

describe('ContactFormController', () => {
    function setup(canManage = true) {
        const table = fakeTable();
        const controller = new ContactFormController(
            organisationService(canManage),
            new ContactFormService({ send: table.send } as any),
        );
        return { table, controller };
    }
    const fields = [{ id: 'mail', type: 'email', label: 'Email', required: true }];

    it('guards both methods, and lets any member read the form', async () => {
        const { controller } = setup(false);

        expect((await controller.get(event('get', { signedIn: false }))).statusCode).toBe(401);
        expect((await controller.put(event('put', { signedIn: false, body: { fields } }))).statusCode).toBe(401);
        expect((await controller.get(event('get'))).statusCode).toBe(404);

        const res = await controller.get(event('get', { org: 'org-a' }));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).updated_at).toBeNull();
    });

    it("saves the form for the caller's organisation only, live on save", async () => {
        const { table, controller } = setup();

        const res = await controller.put(event('put', { org: 'org-a', body: { fields } }));

        expect(res.statusCode).toBe(200);
        expect([...table.items.keys()]).toEqual(['ORG#org-a|CONTACT_FORM']);
        expect(JSON.parse((await controller.get(event('get', { org: 'org-a' }))).body).fields).toEqual(fields);
        expect(JSON.parse((await controller.get(event('get', { org: 'org-b' }))).body).fields).toEqual(
            DEFAULT_CONTACT_FORM_FIELDS,
        );
    });

    it('rejects an invalid form with 400 and a non-admin with 403, saving nothing', async () => {
        const invalid = setup();
        const bad = await invalid.controller.put(
            event('put', { org: 'org-a', body: { fields: [{ id: 'x', type: 'select', label: 'X', required: true }] } }),
        );
        expect(bad.statusCode).toBe(400);
        expect(invalid.table.items.size).toBe(0);

        const member = setup(false);
        expect((await member.controller.put(event('put', { org: 'org-a', body: { fields } }))).statusCode).toBe(403);
        expect(member.table.items.size).toBe(0);

        // Not a member of the organisation named in the session at all: no read, no write.
        const outsider = setup(true);
        expect((await outsider.controller.get(event('get', { org: 'org-x' }))).statusCode).toBe(403);
        expect((await outsider.controller.put(event('put', { org: 'org-x', body: { fields } }))).statusCode).toBe(403);
        expect(outsider.table.items.size).toBe(0);
    });
});
