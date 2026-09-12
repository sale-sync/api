import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Router } from '@devyethiha/samjs';
import DefaultController from './default/default.controller';
import { OrganisationService } from './services/organisation.service';
import { PrivacyPolicyService } from './services/privacy-policy.service';

async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const region = 'ap-southeast-2';
    try {
        const router = new Router(
            event,
            region,
            [{ controller: DefaultController, services: [OrganisationService, PrivacyPolicyService] }],
            '/privacy-policy',
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

// Same withOpenCORS shape as branding/app.ts, testimonials/app.ts, and about/app.ts — reflects
// whatever Origin the request sent instead of a static allow-list, since this route is called from
// an open, growing set of client site domains that can't be enumerated in advance. Safe here since
// this route only ever returns already-published, non-sensitive data.
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
