import { lambdaHandler as handler } from '../../app';
import { lambdaHandler as links } from '../../../links/app';
import { body, event } from '../../../shared/testing/event';
import { quiet, withSamples } from '../../../shared/testing/setup';
import { MOCK_JORDAN } from '../../../shared/seed';
import { createProfile } from '../../../affiliates/affiliate.repository';
import { addLink } from '../../../links/link.repository';

// Clicks domain: silastech.co/r/<slug> opened. The Worker asks which programme the link belongs to (the redirect) and
// whether to count it; no sign-in, no affiliate data in the answer.
const click = (b: unknown) => handler(event('POST', '/affiliates/clicks', { body: b }));
const youtubeClicks = async () =>
    body(await links(event('GET', '/affiliates/links', { user: MOCK_JORDAN }))).links.find((l: { slug: string }) => l.slug === 'jordan-youtube').stats.clicks;

beforeAll(quiet);
beforeEach(async () => {
    await withSamples();
});

it('answers the programme of a link and counts the click', async () => {
    const before = await youtubeClicks();
    const r = await click({ slug: 'jordan-youtube' });
    expect(r.statusCode).toBe(200);
    expect(body(r)).toEqual({ market: 'australia' }); // the programme only, nothing about the affiliate
    expect(await youtubeClicks()).toBe(before + 1);
});
it('a repeat or a bot (count: false) is resolved but not counted', async () => {
    const before = await youtubeClicks();
    expect(body(await click({ slug: 'jordan-youtube', count: false }))).toEqual({ market: 'australia' });
    expect(await youtubeClicks()).toBe(before);
});
it('an address in capitals finds the same link', async () => {
    expect((await click({ slug: 'Jordan-YouTube' })).statusCode).toBe(200);
});
it('404 LINK_NOT_FOUND for an address that is not a link', async () => {
    const r = await click({ slug: 'nobody-here' });
    expect(r.statusCode).toBe(404);
    expect(body(r).code).toBe('LINK_NOT_FOUND');
});
it('400 for an address that cannot be a link', async () => {
    expect((await click({ slug: '../etc' })).statusCode).toBe(400);
    expect((await click({})).statusCode).toBe(400);
});
it("a link whose affiliate is not approved does not work", async () => {
    await createProfile({ userId: 'nok', market: 'thailand', stage: 'refused', first: 'Nok', last: 'S', email: 'n@example.com', phone: '', reach: 'creator', channelUrl: '', plan: '', appliedOn: '2026-11-25' });
    await addLink({ userId: 'nok', channel: 'tiktok', name: 'tiktok', slug: 'nok-tiktok', clicks: 0, createdOn: '2026-11-25' });
    expect((await click({ slug: 'nok-tiktok' })).statusCode).toBe(404);
});
