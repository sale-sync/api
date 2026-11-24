// Who is signed in. The affiliate app's Worker keeps the Cognito tokens in HttpOnly cookies on its own host and forwards the
// ID token to this API as the samjs cookie `Identifier`. samjs's own isAuthorize/getUser only decode that cookie, they do
// not check it, so this file verifies the token's signature, issuer, audience and expiry against the affiliate pool.
//
// AFFILIATE_AUTH picks the mode and must be set (no default, so a misconfigured deploy fails instead of trusting cookies):
//   cognito  the ID token is verified (AFFILIATE_USER_POOL_ID, AFFILIATE_USER_POOL_CLIENT_ID). Staging and production.
//   mock     the cookie is only decoded, as before the pool existed. Unit tests and the switch-over on staging only.
// AFFILIATE_SAMPLE_ACCOUNTS (staging only, never production): "email=sampleUserId,..." lets the staging sample accounts
// in the pool open the sample affiliates (Jordan, Ploy), whose data is keyed by the sample id.
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUser, isAuthorize, NO_USER, UNAUTHORIZE_ERROR } from '@devyethiha/samjs';
import { CognitoJwtVerifier } from 'aws-jwt-verify';

export type SignedIn = { id: string; email: string };
type Verifier = { verify(token: string): Promise<Record<string, unknown>> };

let verifier: Verifier | null = null;
/** Tests replace the verifier (a local key instead of the pool's published keys). */
export function setVerifier(v: Verifier | null): void {
    verifier = v;
}
function cognitoVerifier(): Verifier {
    if (verifier) return verifier;
    const userPoolId = process.env.AFFILIATE_USER_POOL_ID;
    const clientId = process.env.AFFILIATE_USER_POOL_CLIENT_ID;
    if (!userPoolId || !clientId) throw new Error('AFFILIATE_USER_POOL_ID and AFFILIATE_USER_POOL_CLIENT_ID must be set when AFFILIATE_AUTH is cognito');
    verifier = CognitoJwtVerifier.create({ userPoolId, clientId, tokenUse: 'id' }) as unknown as Verifier;
    return verifier;
}

export function authMode(): 'cognito' | 'mock' {
    const mode = process.env.AFFILIATE_AUTH;
    if (mode === 'cognito' || mode === 'mock') return mode;
    throw new Error('AFFILIATE_AUTH environment variable must be cognito or mock');
}

/** The staging sample accounts: verified email to sample user id. Empty unless AFFILIATE_SAMPLE_ACCOUNTS is set. */
export function sampleAccounts(): Map<string, string> {
    const m = new Map<string, string>();
    for (const pair of (process.env.AFFILIATE_SAMPLE_ACCOUNTS ?? '').split(',')) {
        const [email, id] = pair.split('=').map((s) => s.trim());
        if (email && id) m.set(email.toLowerCase(), id);
    }
    return m;
}

function cookie(event: APIGatewayProxyEvent, name: string): string | null {
    const header = event.headers?.cookie ?? event.headers?.Cookie ?? '';
    for (const part of header.split(';')) {
        const i = part.indexOf('=');
        if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
    }
    return null;
}

/** The signed-in user, or the response to send (401 when the token is missing, invalid or expired). */
export async function signedInUser(event: APIGatewayProxyEvent): Promise<SignedIn | APIGatewayProxyResult> {
    if (authMode() === 'mock') {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;
        const user = getUser(event);
        if (!user?.id) return NO_USER;
        return { id: user.id, email: user.email };
    }
    const token = cookie(event, 'Identifier');
    if (!token) return UNAUTHORIZE_ERROR;
    let claims: Record<string, unknown>;
    try {
        claims = await cognitoVerifier().verify(token);
    } catch {
        return UNAUTHORIZE_ERROR; // bad signature, another pool or client, an access token, or expired
    }
    const sub = typeof claims.sub === 'string' ? claims.sub : '';
    const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : '';
    if (!sub) return NO_USER;
    if (claims.email_verified !== true) return UNAUTHORIZE_ERROR; // the app confirms the email before signing in
    const sample = sampleAccounts().get(email);
    return { id: sample ?? sub, email };
}
