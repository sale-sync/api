// Who is reviewing. The team reviews applications in the team portal (platform/apps/team-portal), which signs in with its own
// Firebase project, not the affiliate Cognito pool. The portal's Worker forwards the reviewer's Firebase ID token as
// `Authorization: Bearer <token>`; this file verifies it (signature against Google's keys, issuer and audience of the
// project, expiry) and then checks the email against the reviewer list. Used by the reviews Lambda only.
//
// REVIEW_FIREBASE_PROJECT_ID  the team portal's Firebase project (silas-team-portal); must be set
// AFFILIATE_REVIEWERS         emails allowed to review, separated by , or ; (the team portal has no self sign-up)
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { JwtRsaVerifier } from 'aws-jwt-verify';
import { json } from './http';

const GOOGLE_JWKS = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
type Verifier = { verify(token: string): Promise<Record<string, unknown>> };

let verifier: Verifier | null = null;
/** Tests replace the verifier (a local key instead of Google's published keys). */
export function setReviewerVerifier(v: Verifier | null): void {
    verifier = v;
}
function firebaseVerifier(): Verifier {
    if (verifier) return verifier;
    const project = process.env.REVIEW_FIREBASE_PROJECT_ID;
    if (!project) throw new Error('REVIEW_FIREBASE_PROJECT_ID environment variable is not set');
    verifier = JwtRsaVerifier.create({ issuer: `https://securetoken.google.com/${project}`, audience: project, jwksUri: GOOGLE_JWKS }) as unknown as Verifier;
    return verifier;
}

export const reviewers = (): Set<string> =>
    new Set(
        (process.env.AFFILIATE_REVIEWERS ?? '')
            .split(/[,;]/)
            .map((e) => e.trim().toLowerCase())
            .filter(Boolean),
    );

const UNAUTHORIZED = json(401, { code: 'NOT_SIGNED_IN', message: 'Sign in to the team portal' });
const FORBIDDEN = json(403, { code: 'NOT_A_REVIEWER', message: 'This account cannot review affiliate applications' });

/** The reviewer's email, or the response to send (401 without a valid token, 403 for an email not on the list). */
export async function signedInReviewer(event: APIGatewayProxyEvent): Promise<{ email: string } | APIGatewayProxyResult> {
    const header = event.headers?.authorization ?? event.headers?.Authorization ?? '';
    const token = /^Bearer\s+(\S+)$/.exec(header)?.[1];
    if (!token) return UNAUTHORIZED;
    let claims: Record<string, unknown>;
    try {
        claims = await firebaseVerifier().verify(token);
    } catch {
        return UNAUTHORIZED;
    }
    // Firebase sets `sub` to the user id; a token minted for a custom sign-in without an email is refused
    const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : '';
    if (!email || typeof claims.sub !== 'string' || !claims.sub) return UNAUTHORIZED;
    if (!reviewers().has(email)) return FORBIDDEN;
    return { email };
}
