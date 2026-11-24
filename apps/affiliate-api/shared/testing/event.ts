// Builds API Gateway events for the handler tests, signed in with the samjs cookies (an unsigned ID token with `sub`).
import type { APIGatewayProxyEvent } from 'aws-lambda';

export function idToken(sub: string, email = `${sub}@example.com`): string {
    const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${part({ alg: 'none', typ: 'JWT' })}.${part({ sub, email, name: sub, email_verified: true })}.sig`;
}
export function event(method: string, path: string, opts: { user?: string; body?: unknown; query?: Record<string, string> } = {}): APIGatewayProxyEvent {
    const headers: Record<string, string> = { origin: 'https://staging-affiliate.silastech.co' };
    if (opts.user) headers.cookie = `Authentication=mock-access-token; Identifier=${idToken(opts.user)}`;
    return {
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
}
export const body = (r: { body: string }) => JSON.parse(r.body);
