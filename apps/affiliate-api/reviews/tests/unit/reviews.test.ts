import { generateKeyPairSync, createSign } from 'crypto';
import { JwtRsaVerifier } from 'aws-jwt-verify';
import { lambdaHandler as handler } from '../../app';
import { lambdaHandler as affiliates } from '../../../affiliates/app';
import { lambdaHandler as links } from '../../../links/app';
import { body, event } from '../../../shared/testing/event';
import { quiet, withSamples } from '../../../shared/testing/setup';
import { setReviewerVerifier } from '../../../shared/reviewer';
import { createProfile } from '../../../affiliates/affiliate.repository';
import { MOCK_JORDAN } from '../../../shared/seed';
import { mockClient } from 'aws-sdk-client-mock';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { decisionEmail } from '../../decision-email';

// Reviews domain: team portal reviewers (their Firebase sign-in, a local key here) list applications by stage and approve
// them, or refuse them with a reason the applicant sees. Only a pending application can be decided.
const PROJECT = 'silas-team-portal';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: 'jwk' }) as { kty: string; n: string; e: string }), kid: 'f1', alg: 'RS256', use: 'sig' };
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
function firebaseToken(claims: Record<string, unknown> = {}): string {
    const now = Math.floor(Date.now() / 1000);
    const payload = { iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: 'fb-uid-1', user_id: 'fb-uid-1', email: 'Atom@Silastech.co', iat: now, exp: now + 3600, auth_time: now, ...claims };
    const head = `${b64({ alg: 'RS256', kid: 'f1', typ: 'JWT' })}.${b64(payload)}`;
    return `${head}.${createSign('RSA-SHA256').update(head).sign(privateKey).toString('base64url')}`;
}
const review = (method: string, opts: { token?: string; body?: unknown; query?: Record<string, string> } = {}) => {
    const e = event(method, '/affiliates/reviews', { body: opts.body, query: opts.query });
    if (opts.token) e.headers.authorization = `Bearer ${opts.token}`;
    return handler(e);
};
const T = () => firebaseToken();
const apply = (userId: string, appliedOn: string, market: 'australia' | 'thailand' = 'thailand') =>
    createProfile({ userId, market, stage: 'pending', first: userId, last: 'Test', email: `${userId}@example.com`, phone: '', reach: 'creator', channelUrl: '', plan: '', appliedOn });

beforeAll(quiet);
beforeEach(async () => {
    await withSamples();
    process.env.AFFILIATE_REVIEWERS = 'atom@silastech.co; scott@silastech.co';
    const v = JwtRsaVerifier.create({ issuer: `https://securetoken.google.com/${PROJECT}`, audience: PROJECT, jwksUri: 'https://example.invalid/jwks' });
    v.cacheJwks({ keys: [jwk] });
    setReviewerVerifier(v as never);
});
afterAll(() => setReviewerVerifier(null));

describe('who can review', () => {
    it('needs the team portal sign-in (401)', async () => {
        expect((await review('GET')).statusCode).toBe(401);
    });
    it('never accepts the affiliate sign-in cookie', async () => {
        expect((await handler(event('GET', '/affiliates/reviews', { user: MOCK_JORDAN }))).statusCode).toBe(401);
    });
    it('refuses a token of another Firebase project (401)', async () => {
        expect((await review('GET', { token: firebaseToken({ iss: 'https://securetoken.google.com/other', aud: 'other' }) })).statusCode).toBe(401);
    });
    it('refuses an expired token (401)', async () => {
        expect((await review('GET', { token: firebaseToken({ exp: Math.floor(Date.now() / 1000) - 60 }) })).statusCode).toBe(401);
    });
    it('refuses a team member who is not a reviewer (403)', async () => {
        const r = await review('GET', { token: firebaseToken({ email: 'someone@silastech.co' }) });
        expect(r.statusCode).toBe(403);
        expect(body(r).code).toBe('NOT_A_REVIEWER');
    });
});

describe('listing', () => {
    it('lists pending applications oldest first, with the count of every stage', async () => {
        await apply('newer', '2026-11-25');
        await apply('older', '2026-11-20', 'australia');
        const r = body(await review('GET', { token: T() }));
        expect(r.applications.map((a: { userId: string }) => a.userId)).toEqual(['older', 'newer']);
        expect(r.counts).toEqual({ pending: 2, approved: 2, refused: 0 }); // the two samples are approved
    });
    it('reads one application, and 404 for an unknown one', async () => {
        await apply('nok', '2026-11-25');
        expect(body(await review('GET', { token: T(), query: { userId: 'nok' } })).application).toMatchObject({ userId: 'nok', stage: 'pending' });
        expect((await review('GET', { token: T(), query: { userId: 'nobody' } })).statusCode).toBe(404);
    });
    it('refuses an unknown stage', async () => {
        expect((await review('GET', { token: T(), query: { stage: 'maybe' } })).statusCode).toBe(400);
    });
});

describe('deciding', () => {
    it('approves: the affiliate can make links at once', async () => {
        await apply('nok', '2026-11-25');
        const r = await review('POST', { token: T(), body: { userId: 'nok', decision: 'approve' } });
        expect(r.statusCode).toBe(200);
        expect(body(r).application).toMatchObject({ stage: 'approved', reviewedBy: 'atom@silastech.co' });
        const made = await links(event('POST', '/affiliates/links', { user: 'nok', body: { channel: 'tiktok', slug: 'nok-tiktok' } }));
        expect(made.statusCode).toBe(201);
    });
    it('refuses with a reason: the applicant sees the reason, not who reviewed, and cannot make links', async () => {
        await apply('nok', '2026-11-25');
        const reason = 'We could not find an audience of agencies on your channel.';
        expect((await review('POST', { token: T(), body: { userId: 'nok', decision: 'refuse', reason } })).statusCode).toBe(200);
        const own = body(await affiliates(event('GET', '/affiliates', { user: 'nok' }))).affiliate;
        expect(own).toMatchObject({ stage: 'refused', refusalReason: reason, market: 'thailand' });
        expect(own.reviewedBy).toBeUndefined();
        const made = await links(event('POST', '/affiliates/links', { user: 'nok', body: { channel: 'tiktok', slug: 'nok-tiktok' } }));
        expect(made.statusCode).toBe(403);
        expect(body(made).message).toBe('The application was not approved');
    });
    it('a refusal needs a reason', async () => {
        await apply('nok', '2026-11-25');
        expect((await review('POST', { token: T(), body: { userId: 'nok', decision: 'refuse' } })).statusCode).toBe(400);
        expect((await review('POST', { token: T(), body: { userId: 'nok', decision: 'refuse', reason: 'no' } })).statusCode).toBe(400);
    });
    it('only a pending application can be decided (409 ALREADY_REVIEWED)', async () => {
        await apply('nok', '2026-11-25');
        await review('POST', { token: T(), body: { userId: 'nok', decision: 'approve' } });
        const again = await review('POST', { token: T(), body: { userId: 'nok', decision: 'refuse', reason: 'Changed my mind about this one.' } });
        expect(again.statusCode).toBe(409);
        expect(body(again).code).toBe('ALREADY_REVIEWED');
    });
    it('the affiliate editing their profile keeps the review', async () => {
        await apply('nok', '2026-11-25');
        await review('POST', { token: T(), body: { userId: 'nok', decision: 'approve' } });
        await affiliates(event('PUT', '/affiliates', { user: 'nok', body: { first: 'Nok', last: 'S', phone: '' } }));
        expect(body(await review('GET', { token: T(), query: { userId: 'nok' } })).application).toMatchObject({ stage: 'approved', reviewedBy: 'atom@silastech.co', first: 'Nok' });
    });
});

describe('the email to the applicant', () => {
    const ses = mockClient(SESv2Client);
    const apply2 = (userId: string, email: string, market: 'australia' | 'thailand' = 'australia') =>
        createProfile({ userId, market, stage: 'pending', first: 'Jo', last: 'Test', email, phone: '', reach: 'creator', channelUrl: '', plan: '', appliedOn: '2026-11-25' });
    beforeEach(() => {
        ses.reset();
        process.env.AFFILIATE_DECISION_EMAILS = 'on';
        process.env.AFFILIATE_STAGE = 'staging';
    });
    afterAll(() => {
        delete process.env.AFFILIATE_DECISION_EMAILS;
        delete process.env.AFFILIATE_STAGE;
    });

    it('is off unless switched on', async () => {
        process.env.AFFILIATE_DECISION_EMAILS = 'off';
        await apply2('jo', 'jo@example.com');
        expect(body(await review('POST', { token: T(), body: { userId: 'jo', decision: 'approve' } })).email).toBe('off');
        expect(ses.commandCalls(SendEmailCommand)).toHaveLength(0);
    });
    it('approved: sent from the staging sender to the applicant, with the Links page', async () => {
        await apply2('jo', 'jo@example.com');
        const r = body(await review('POST', { token: T(), body: { userId: 'jo', decision: 'approve' } }));
        expect(r.email).toBe('sent');
        const sent = ses.commandCalls(SendEmailCommand)[0].args[0].input;
        expect(sent.FromEmailAddress).toBe('Silas Tech Affiliate (staging) <noreply@silastech.co>');
        expect(sent.Destination?.ToAddresses).toEqual(['jo@example.com']);
        expect(sent.Content?.Simple?.Subject?.Data).toBe('Your Silas Tech Affiliate application is approved');
        expect(sent.Content?.Simple?.Body?.Text?.Data).toContain('https://staging-affiliate.silastech.co/dashboard/links');
    });
    it('production: the plain sender name and the live app', async () => {
        process.env.AFFILIATE_STAGE = 'production';
        await apply2('jo', 'jo@example.com');
        await review('POST', { token: T(), body: { userId: 'jo', decision: 'approve' } });
        const sent = ses.commandCalls(SendEmailCommand)[0].args[0].input;
        expect(sent.FromEmailAddress).toBe('Silas Tech Affiliate <noreply@silastech.co>');
        expect(sent.Content?.Simple?.Body?.Text?.Data).toContain('https://affiliate.silastech.co/dashboard/links');
    });
    it('never mails the staging sample addresses (no mailbox, no bounces)', async () => {
        await apply2('jo', 'affiliate-check-1@sample.silastech.co');
        expect(body(await review('POST', { token: T(), body: { userId: 'jo', decision: 'approve' } })).email).toBe('skipped');
        expect(ses.commandCalls(SendEmailCommand)).toHaveLength(0);
    });
    it('a failed email keeps the decision', async () => {
        ses.on(SendEmailCommand).rejects(new Error('throttled'));
        await apply2('jo', 'jo@example.com');
        const r = await review('POST', { token: T(), body: { userId: 'jo', decision: 'refuse', reason: 'No audience on the channel you shared.' } });
        expect(r.statusCode).toBe(200);
        expect(body(r).email).toBe('failed');
        expect(body(await review('GET', { token: T(), query: { userId: 'jo' } })).application.stage).toBe('refused');
    });
    it('refused: the reason as text, escaped in the HTML, never who reviewed', () => {
        const m = decisionEmail(
            { userId: 'n', market: 'thailand', stage: 'refused', first: 'Nok', last: 'S', email: 'n@example.com', phone: '', reach: 'creator', channelUrl: '', plan: '', appliedOn: '2026-11-25', reviewedBy: 'atom@silastech.co', refusalReason: 'No <b>audience</b> & no plan' },
            'staging',
        );
        expect(m.subject).toBe('About your Silas Tech Affiliate application');
        expect(m.text).toContain('real estate in Thailand programme');
        expect(m.text).toContain('No <b>audience</b> & no plan');
        expect(m.html).toContain('No &lt;b&gt;audience&lt;/b&gt; &amp; no plan');
        expect(m.html + m.text).not.toContain('atom@silastech.co');
    });
    it('approved: the commission line comes from the rules, per programme', () => {
        const m = decisionEmail(
            { userId: 'n', market: 'thailand', stage: 'approved', first: 'Nok', last: 'S', email: 'n@example.com', phone: '', reach: 'creator', channelUrl: '', plan: '', appliedOn: '2026-11-25' },
            'staging',
        );
        expect(m.text).toContain('When a real estate agency subscribes through your link, you earn 4%, 8% or 16% of their 6, 12 or 24 month subscription.');
    });
});
