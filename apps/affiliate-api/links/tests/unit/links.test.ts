import { lambdaHandler as handler } from '../../app';
import { body, event } from '../../../shared/testing/event';
import { freshTable, quiet, withSamples } from '../../../shared/testing/setup';
import { MOCK_JORDAN } from '../../../shared/seed';
import { createProfile } from '../../../affiliates/affiliate.repository';

// Links domain: several links per affiliate, each with its own results, and link addresses unique across every affiliate.
const call = (method: string, path: string, o: Parameters<typeof event>[2] = {}) => handler(event(method, path, o));
beforeAll(quiet);
beforeEach(async () => {
    await withSamples();
});

it('needs a signed-in user', async () => {
    expect((await call('GET', '/affiliates/links')).statusCode).toBe(401);
});
it('lists each link with its own results', async () => {
    const links = body(await call('GET', '/affiliates/links', { user: MOCK_JORDAN })).links;
    const youtube = links.find((l: { slug: string }) => l.slug === 'jordan-youtube');
    expect(youtube.url).toBe('https://silastech.co/r/jordan-youtube');
    // Coastline (8% of 1188) and Northside (16% of 2376) came through YouTube; Harbour did not subscribe
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
it('a pending affiliate cannot make links yet', async () => {
    await createProfile({ userId: 'pending-user', market: 'thailand', stage: 'pending', first: 'P', last: 'U', email: '', phone: '', reach: 'creator', channelUrl: '', plan: '', appliedOn: '2026-11-24' });
    const r = await call('POST', '/affiliates/links', { user: 'pending-user', body: { channel: 'tiktok', slug: 'pending-tiktok' } });
    expect(r.statusCode).toBe(403);
    expect(body(r).code).toBe('NOT_APPROVED');
});
it('does not write the sample affiliates itself (only the affiliates Lambda may)', async () => {
    freshTable();
    const r = await call('GET', '/affiliates/links', { user: MOCK_JORDAN });
    expect(body(r).code).toBe('NOT_AN_AFFILIATE');
});
