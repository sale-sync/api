import { APIGatewayProxyResult } from 'aws-lambda';
import { ValidationError } from '@devyethiha/samjs';
import { AlreadyAppliedError, NotAnAffiliateError, NotApprovedError, SlugTakenError } from '../services/errors';

export const json = (statusCode: number, body: unknown): APIGatewayProxyResult => ({ statusCode, body: JSON.stringify(body) });

export function parseBody(body: string | null): unknown {
    try {
        return JSON.parse(body || '{}');
    } catch {
        throw new ValidationError('Request body must be valid JSON', []);
    }
}

/** The canonical samjs error mapping: validation 400, each domain error its status, anything else rethrown (500 in app.ts). */
export function errorResponse(error: unknown): APIGatewayProxyResult {
    if (error instanceof ValidationError) return json(400, { message: error.message, issues: error.issues });
    if (error instanceof NotAnAffiliateError) return json(404, { code: 'NOT_AN_AFFILIATE', message: error.message });
    if (error instanceof NotApprovedError) return json(403, { code: 'NOT_APPROVED', message: error.message });
    if (error instanceof AlreadyAppliedError) return json(409, { code: 'ALREADY_APPLIED', message: error.message });
    if (error instanceof SlugTakenError) return json(409, { code: 'SLUG_TAKEN', message: error.message });
    throw error;
}
