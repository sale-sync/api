import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Router } from '@devyethiha/samjs';
import DefaultController from './default/default.controller';
import { OrganisationService } from './services/organisation.service';
import { BrandingService } from './services/branding.service';

async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const region = 'ap-southeast-2';
    try {
        const router = new Router(
            event,
            region,
            [{ controller: DefaultController, services: [OrganisationService, BrandingService] }],
            '/branding',
        );

        return await router.handle();
    } catch (err) {
        console.log({ err });
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'some error happened' }),
        };
    }
}

// @devyethiha/samjs's withCORS takes a fixed allowedOrigins: string[] and falls back to
// allowedOrigins[0] for any origin not on the list — that fits every other service in this repo,
// which is always called from a small fixed set of first-party origins (app.salesync.biz etc). This
// is the first genuinely public, multi-tenant endpoint: it's called from an open, growing set of
// client site domains that can't be enumerated in advance. Reflect whatever Origin the request sent
// instead of a static allow-list — safe here since this route only ever returns already-published,
// non-sensitive data.
// `Authorization` in Allow-Headers: org identification is a client-attached Bearer token, not a
// cookie (see default.controller.ts) — a client site's own domain shares no parent domain with
// this API's, so a cross-domain cookie could never reach it anyway. A header has no such scoping
// problem, but the browser's CORS preflight still needs it explicitly allow-listed.
function withOpenCORS(
    handler: (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>,
): (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult> {
    return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
        const origin = event.headers?.origin || event.headers?.Origin || '';
        const corsHeaders = {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Methods': 'GET,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type,Accept,Origin,Referer,User-Agent,Authorization',
            'Access-Control-Max-Age': '86400',
            Vary: 'Origin',
        };

        if (event.httpMethod === 'OPTIONS') {
            return { statusCode: 204, headers: corsHeaders, body: '' };
        }

        try {
            const res = await handler(event);
            return { ...res, headers: { ...(res.headers || {}), ...corsHeaders } };
        } catch (err) {
            console.error('Unhandled handler error:', err);
            return {
                statusCode: 500,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Internal server error' }),
            };
        }
    };
}

export const lambdaHandler = withOpenCORS(main);
