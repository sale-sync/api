import { generateKeyPairSync, createSign } from 'crypto';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { lambdaHandler as handler } from '../../app';
import { body, event } from '../../../shared/testing/event';
import { freshTable, quiet } from '../../../shared/testing/setup';
import { setVerifier } from '../../../shared/auth';

// Sign-in with the affiliate Cognito pool: the ID token is verified (signature, pool, client, expiry, email verified), never
// only decoded. A local RSA key stands in for the pool's published keys.
const POOL = 'ap-southeast-2_TestPool1';
const CLIENT = 'testclient123';
const ISS = `https://cognito-idp.ap-southeast-2.amazonaws.com/${POOL}`;
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const { privateKey: otherKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: 'jwk' }) as { kty: string; n: string; e: string }), kid: 'k1', alg: 'RS256', use: 'sig' };

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
function token(claims: Record<string, unknown> = {}, key = privateKey): string {
    const now = Math.floor(Date.now() / 1000);
    const payload = { sub: 'user-sub-1', email: 'Nok@Example.com', email_verified: true, aud: CLIENT, iss: ISS, token_use: 'id', iat: now, exp: now + 3600, auth_time: now, ...claims };
    const head = `${b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' })}.${b64(payload)}`;
    return `${head}.${createSign('RSA-SHA256').update(head).sign(key).toString('base64url')}`;
}
const call = (method: string, path: string, cookie?: string, b?: unknown) => {
    const e = event(method, path, { body: b });
    if (cookie) e.headers.cookie = `Identifier=${cookie}`;
    return handler(e);
};

beforeAll(quiet);
beforeEach(() => {
    freshTable();
    process.env.AFFILIATE_AUTH = 'cognito';
    delete process.env.AFFILIATE_SAMPLE_ACCOUNTS;
    const v = CognitoJwtVerifier.create({ userPoolId: POOL, clientId: CLIENT, tokenUse: 'id' });
    v.cacheJwks({ keys: [jwk] });
    setVerifier(v as never);
});
afterAll(() => setVerifier(null));

it('a verified ID token signs the user in, keyed by its sub, with the email from the token', async () => {
    const r = await call('POST', '/affiliates/application', token(), { market: 'thailand', first: 'Nok', last: 'Test', reach: 'creator' });
    expect(r.statusCode).toBe(201);
    expect(body(r).affiliate).toMatchObject({ userId: 'user-sub-1', email: 'nok@example.com', market: 'thailand' });
});
it.each([
    ['no token', undefined],
    ['an unsigned token (the old mock cookie)', `${b64({ alg: 'none' })}.${b64({ sub: 'mock-affiliate-jordan', email: 'x@y.z' })}.sig`],
    ['a token signed with another key', token({}, otherKey)],
    ['an expired token', token({ exp: Math.floor(Date.now() / 1000) - 60 })],
    ['a token for another app client', token({ aud: 'another-client' })],
    ['a token from another pool', token({ iss: 'https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_Other' })],
    ['an access token', token({ token_use: 'access' })],
    ['an email that is not verified', token({ email_verified: false })],
])('refuses %s (401)', async (_name, t) => {
    expect((await call('GET', '/affiliates', t)).statusCode).toBe(401);
});
it('maps a staging sample account to its sample affiliate', async () => {
    process.env.AFFILIATE_SAMPLE_ACCOUNTS = 'ploy.sample@example.com:mock-affiliate-ploy;jordan.sample@example.com:mock-affiliate-jordan';
    const r = await call('GET', '/affiliates', token({ email: 'Jordan.Sample@example.com' }));
    expect(body(r).affiliate).toMatchObject({ userId: 'mock-affiliate-jordan', first: 'Jordan' });
});
it('refuses to run without a sign-in mode (never falls back to trusting the cookie)', async () => {
    delete process.env.AFFILIATE_AUTH;
    expect((await call('GET', '/affiliates', token())).statusCode).toBe(500);
});
