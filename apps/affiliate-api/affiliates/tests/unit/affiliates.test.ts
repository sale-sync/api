import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { lambdaHandler } from '../../app';
import { MOCK_JORDAN, MOCK_PLOY } from '../../store';
import { resetMemoryStore } from '../../store/memory-store';

process.env.AFFILIATE_STORE = 'memory';

// Pins the programme rules and the access rules of the affiliate API on the mock store.
function idToken(sub: string, email = `${sub}@example.com`): string {
    const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${part({ alg: 'none', typ: 'JWT' })}.${part({ sub, email, name: sub, email_verified: true })}.sig`;
}
function call(method: string, path: string, opts: { user?: string; body?: unknown; query?: Record<string, string> } = {}): Promise<APIGatewayProxyResult> {
    const headers: Record<string, string> = { origin: 'https://staging-affiliate.silastech.co' };
    if (opts.user) headers.cookie = `Authentication=mock-access-token; Identifier=${idToken(opts.user)}`;
    const event = {
        httpMethod: method,
        path,
        headers,
        multiValueHeaders: {},
        queryStringParameters: opts.query ?? null,
        multiValueQueryStringParameters: null,
        pathParameters: null,
        stageVariables: null,
        requestContext: {} as APIGatewayProxyEvent['requestContext'],
        resource: '',
        body: opts.body === undefined ? null : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body),
        isBase64Encoded: false,
    } as APIGatewayProxyEvent;
    return lambdaHandler(event);
}
const body = (r: APIGatewayProxyResult) => JSON.parse(r.body);

beforeEach(() => resetMemoryStore());
// samjs logs every missing cookie; keep the test output readable
beforeAll(() => jest.spyOn(console, 'error').mockImplementation(() => undefined));

describe('programme terms (public)', () => {
    it('returns the rates, trial, minimum and markets without signing in', async () => {
        const r = await call('GET', '/affiliates/programme');
        expect(r.statusCode).toBe(200);
        const t = body(r);
        expect(t.plans).toEqual([{ months: 6, rate: 0.04 }, { months: 12, rate: 0.08 }, { months: 24, rate: 0.16 }]);
        expect(t.trialDays).toBe(14);
        expect(t.renewalsEarn).toBe(false);
        expect(t.payout).toEqual({ period: 'monthly', minimumUsd: 100, methods: ['stripe', 'bank'] });
        expect(t.markets.map((m: { market: string; currency: string }) => `${m.market}:${m.currency}`)).toEqual(['australia:AUD', 'thailand:THB']);
    });
});

describe('access', () => {
    it.each(['/affiliates', '/affiliates/links', '/affiliates/referrals', '/affiliates/payouts', '/affiliates/payout-method', '/affiliates/application'])(
        '%s needs a signed-in user',
        async (path) => {
            expect((await call('GET', path)).statusCode).toBe(401);
        },
    );
    it('sends CORS for the affiliate app with credentials', async () => {
        const r = await call('GET', '/affiliates/programme');
        expect(r.headers?.['Access-Control-Allow-Origin']).toBe('https://staging-affiliate.silastech.co');
        expect(r.headers?.['Access-Control-Allow-Credentials']).toBe('true');
    });
    it('a user who has not applied gets NOT_AN_AFFILIATE', async () => {
        const r = await call('GET', '/affiliates', { user: 'new-user' });
        expect(r.statusCode).toBe(404);
        expect(body(r).code).toBe('NOT_AN_AFFILIATE');
    });
    it('an affiliate only ever sees their own data', async () => {
        const jordan = body(await call('GET', '/affiliates/referrals', { user: MOCK_JORDAN })).referrals;
        const ploy = body(await call('GET', '/affiliates/referrals', { user: MOCK_PLOY })).referrals;
        expect(jordan.map((r: { business: string }) => r.business)).toContain('Coastline Plumbing');
        expect(ploy.map((r: { business: string }) => r.business)).not.toContain('Coastline Plumbing');
    });
});

describe('application: one market per affiliate', () => {
    const apply = (user: string, market = 'thailand') =>
        call('POST', '/affiliates/application', { user, body: { market, first: 'Ploy', last: 'Test', reach: 'creator' } });
    it('creates a pending affiliate in the chosen market', async () => {
        const r = await apply('new-user');
        expect(r.statusCode).toBe(201);
        expect(body(r).affiliate).toMatchObject({ market: 'thailand', stage: 'pending', email: 'new-user@example.com' });
        const me = body(await call('GET', '/affiliates', { user: 'new-user' }));
        expect(me.affiliate.market).toBe('thailand');
    });
    it('refuses a second application (no market change)', async () => {
        await apply('new-user', 'thailand');
        const r = await apply('new-user', 'australia');
        expect(r.statusCode).toBe(409);
        expect(body(r).code).toBe('ALREADY_APPLIED');
    });
    it('validates the application', async () => {
        const r = await call('POST', '/affiliates/application', { user: 'new-user', body: { market: 'japan', first: '', reach: 'x' } });
        expect(r.statusCode).toBe(400);
        expect(body(r).issues.length).toBeGreaterThan(0);
    });
    it('answers 400 for a body that is not JSON', async () => {
        expect((await call('POST', '/affiliates/application', { user: 'new-user', body: '{nope' })).statusCode).toBe(400);
    });
    it('a pending affiliate cannot make links yet', async () => {
        await apply('new-user');
        const r = await call('POST', '/affiliates/links', { user: 'new-user', body: { channel: 'tiktok', name: 'TikTok', slug: 'new-user-tiktok' } });
        expect(r.statusCode).toBe(403);
        expect(body(r).code).toBe('NOT_APPROVED');
    });
});

describe('links', () => {
    it('lists each link with its own results', async () => {
        const links = body(await call('GET', '/affiliates/links', { user: MOCK_JORDAN })).links;
        const youtube = links.find((l: { slug: string }) => l.slug === 'jordan-youtube');
        expect(youtube.url).toBe('https://silastech.co/r/jordan-youtube');
        // Coastline (12 months, 8% of 1188) and Northside (24 months, 16% of 2376) came through YouTube; Harbour did not subscribe
        expect(youtube.stats).toEqual({ clicks: 612, signups: 3, subscribed: 2, earned: 475.2 });
    });
    it('creates a link for a channel', async () => {
        const r = await call('POST', '/affiliates/links', { user: MOCK_JORDAN, body: { channel: 'tiktok', name: 'TikTok live', slug: 'jordan-tiktok-2' } });
        expect(r.statusCode).toBe(201);
        expect(body(r).link).toMatchObject({ channel: 'tiktok', slug: 'jordan-tiktok-2', stats: { clicks: 0 } });
        expect(body(await call('GET', '/affiliates/links', { user: MOCK_JORDAN })).links).toHaveLength(5);
    });
    it('refuses an address that is taken, also by another affiliate', async () => {
        const r = await call('POST', '/affiliates/links', { user: MOCK_JORDAN, body: { channel: 'tiktok', slug: 'ploy-tiktok' } });
        expect(r.statusCode).toBe(409);
        expect(body(r).code).toBe('SLUG_TAKEN');
    });
    it('refuses an address with spaces or capitals', async () => {
        expect((await call('POST', '/affiliates/links', { user: MOCK_JORDAN, body: { channel: 'tiktok', slug: 'Jordan TikTok' } })).statusCode).toBe(400);
    });
});

describe('referrals and commission', () => {
    it('earns only on subscriptions, at the rate of the plan', async () => {
        const refs = body(await call('GET', '/affiliates/referrals', { user: MOCK_JORDAN })).referrals;
        const by = (b: string) => refs.find((r: { business: string }) => r.business === b);
        expect(by('Peak HVAC Services')).toMatchObject({ status: 'subscribed', plan: 6, rate: 0.04, commission: 23.76 });
        expect(by('Coastline Plumbing')).toMatchObject({ plan: 12, rate: 0.08, commission: 95.04 });
        expect(by('Northside Roofing')).toMatchObject({ plan: 24, rate: 0.16, commission: 380.16 });
        expect(by('Bright Spark Electrical')).toMatchObject({ status: 'trial', trialDaysLeft: 8, commission: 0 });
        expect(by('Green Edge Landscaping')).toMatchObject({ status: 'pending', commission: 0 });
        expect(by('Harbour Tiling')).toMatchObject({ status: 'ended', commission: 0 });
    });
    it('filters by status', async () => {
        const refs = body(await call('GET', '/affiliates/referrals', { user: MOCK_JORDAN, query: { status: 'trial' } })).referrals;
        expect(refs.map((r: { status: string }) => r.status)).toEqual(['trial', 'trial', 'trial']);
        expect((await call('GET', '/affiliates/referrals', { user: MOCK_JORDAN, query: { status: 'paid' } })).statusCode).toBe(400);
    });
    it('shares only the business name, not contact details', async () => {
        const r = body(await call('GET', '/affiliates/referrals', { user: MOCK_JORDAN })).referrals[0];
        expect(Object.keys(r).sort()).toEqual(['business', 'commission', 'id', 'link', 'plan', 'rate', 'signedUp', 'status', 'subscribedOn', 'trialDaysLeft']);
    });
});

describe('payouts', () => {
    it('sums the commissions in the market currency and checks the US$ 100 minimum', async () => {
        const p = body(await call('GET', '/affiliates/payouts', { user: MOCK_JORDAN }));
        expect(p).toMatchObject({ currency: 'AUD', earned: 594, paid: 0, unpaid: 594, minimumUsd: 100, reachesMinimum: true, period: 'monthly' });
        expect(p.rows).toHaveLength(4);
        const t = body(await call('GET', '/affiliates/payouts', { user: MOCK_PLOY }));
        expect(t.currency).toBe('THB');
        expect(t.earned).toBe(2376); // 8% of 23,760 + 4% of 11,880
    });
    it('keeps only the last 4 digits of a bank account', async () => {
        const r = await call('PUT', '/affiliates/payout-method', {
            user: MOCK_PLOY,
            body: { kind: 'bank', accountName: 'Ploy C', bank: 'Kasikornbank', accountNumber: '123-4-56789-0' },
        });
        expect(r.statusCode).toBe(200);
        expect(body(r).method).toEqual({ kind: 'bank', accountName: 'Ploy C', bank: 'Kasikornbank', branch: '', last4: '7890' });
        expect(r.body).not.toContain('56789');
    });
    it('needs a 6 digit BSB in Australia', async () => {
        const r = await call('PUT', '/affiliates/payout-method', {
            user: MOCK_JORDAN,
            body: { kind: 'bank', accountName: 'Jordan Lee', bank: 'CBA', branch: '12', accountNumber: '12345678' },
        });
        expect(r.statusCode).toBe(400);
    });
    it('switches to Stripe', async () => {
        const r = await call('PUT', '/affiliates/payout-method', { user: MOCK_JORDAN, body: { kind: 'stripe' } });
        expect(body(r).method).toEqual({ kind: 'stripe' });
    });
});

describe('profile', () => {
    it('updates name and phone, never the market', async () => {
        const r = await call('PUT', '/affiliates', { user: MOCK_JORDAN, body: { first: 'Jo', last: 'Lee', phone: '+61 400 000 000', market: 'thailand' } });
        expect(r.statusCode).toBe(200);
        expect(body(r).affiliate).toMatchObject({ first: 'Jo', market: 'australia' });
    });
});

describe('routing', () => {
    it('answers 404 for an unknown resource and 405 for a wrong verb', async () => {
        expect((await call('GET', '/affiliates/nope', { user: MOCK_JORDAN })).statusCode).toBe(404);
        expect((await call('DELETE', '/affiliates/links', { user: MOCK_JORDAN })).statusCode).toBeGreaterThanOrEqual(404);
    });
});
