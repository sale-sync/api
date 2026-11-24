import { lambdaHandler as handler } from '../../app';
import { body, event } from '../../../shared/testing/event';
import { freshTable, quiet } from '../../../shared/testing/setup';
import { MOCK_JORDAN } from '../../../shared/seed';
import { table } from '../../../shared/db';

// Affiliates domain: the account and the application (one market per affiliate), and the sample affiliates written on first use.
const call = (method: string, path: string, o: Parameters<typeof event>[2] = {}) => handler(event(method, path, o));
let fake: ReturnType<typeof freshTable>;
beforeAll(quiet);
beforeEach(() => {
    fake = freshTable();
});

describe('account', () => {
    it.each(['/affiliates', '/affiliates/application'])('%s needs a signed-in user', async (p) => {
        expect((await call('GET', p)).statusCode).toBe(401);
    });
    it('a user who has not applied gets NOT_AN_AFFILIATE (and nothing is written)', async () => {
        const r = await call('GET', '/affiliates', { user: 'new-user' });
        expect(r.statusCode).toBe(404);
        expect(body(r).code).toBe('NOT_AN_AFFILIATE');
        expect(fake.items.size).toBe(0);
    });
    it('writes a sample affiliate on first use, with links, address reservations, referrals and payout method', async () => {
        const r = await call('GET', '/affiliates', { user: MOCK_JORDAN });
        expect(body(r).affiliate).toMatchObject({ first: 'Jordan', market: 'australia', stage: 'approved' });
        const sks = [...fake.items.values()].map((i) => String(i.SK));
        expect(sks.filter((s) => s.startsWith('LINK#'))).toHaveLength(4);
        expect(sks.filter((s) => s === 'SLUG')).toHaveLength(4);
        expect(sks.filter((s) => s.startsWith('REF#'))).toHaveLength(9);
        expect(sks.filter((s) => s === 'PAYOUT')).toHaveLength(1);
        await call('GET', '/affiliates', { user: MOCK_JORDAN });
        expect(fake.items.size).toBe(19); // profile + 4 links + 4 slugs + 9 referrals + payout, written once
    });
    it('updates name and phone, never the market', async () => {
        const r = await call('PUT', '/affiliates', { user: MOCK_JORDAN, body: { first: 'Jo', last: 'Lee', phone: '+61 400 000 000', market: 'thailand' } });
        expect(r.statusCode).toBe(200);
        expect(body(r).affiliate).toMatchObject({ first: 'Jo', market: 'australia' });
    });
});

describe('application: one market per affiliate', () => {
    const apply = (user: string, market = 'thailand') => call('POST', '/affiliates/application', { user, body: { market, first: 'Nok', last: 'Test', reach: 'creator' } });
    it('creates a pending affiliate in the chosen market', async () => {
        const r = await apply('new-user');
        expect(r.statusCode).toBe(201);
        expect(body(r).affiliate).toMatchObject({ market: 'thailand', stage: 'pending', email: 'new-user@example.com' });
        expect(body(await call('GET', '/affiliates/application', { user: 'new-user' }))).toMatchObject({ market: 'thailand', stage: 'pending' });
    });
    it('refuses a second application (no market change)', async () => {
        await apply('new-user', 'thailand');
        const r = await apply('new-user', 'australia');
        expect(r.statusCode).toBe(409);
        expect(body(r).code).toBe('ALREADY_APPLIED');
    });
    it('a sample affiliate cannot apply again either', async () => {
        expect((await apply(MOCK_JORDAN)).statusCode).toBe(409);
    });
    it('validates the application and the JSON', async () => {
        const r = await call('POST', '/affiliates/application', { user: 'new-user', body: { market: 'japan', first: '', reach: 'x' } });
        expect(r.statusCode).toBe(400);
        expect(body(r).issues.length).toBeGreaterThan(0);
        expect((await call('POST', '/affiliates/application', { user: 'new-user', body: '{nope' })).statusCode).toBe(400);
    });
});

describe('this Lambda', () => {
    it('sends CORS for the affiliate app with credentials', async () => {
        const r = await call('GET', '/affiliates', { user: MOCK_JORDAN });
        expect(r.headers?.['Access-Control-Allow-Origin']).toBe('https://staging-affiliate.silastech.co');
        expect(r.headers?.['Access-Control-Allow-Credentials']).toBe('true');
    });
    it('does not answer another domain', async () => {
        expect((await call('GET', '/affiliates/links', { user: MOCK_JORDAN })).statusCode).toBe(404);
    });
    it('needs the table name (never falls back to another table)', () => {
        delete process.env.AFFILIATE_TABLE_NAME;
        expect(() => table()).toThrow('AFFILIATE_TABLE_NAME environment variable is not set');
    });
});
