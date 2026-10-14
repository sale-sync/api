import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Router } from '@devyethiha/samjs';
import DefaultController from './default/default.controller';
import { OrganisationService } from './services/organisation.service';
import { ContactFormService } from './services/contact-form.service';
import { ContactSubmissionService } from './services/contact-submission.service';

// A submission is a handful of short strings plus at most a few textareas (5,000 characters each),
// so anything bigger than this is not a real form post. Checked before the body is parsed.
const MAX_BODY_BYTES = 32 * 1024;

async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const region = 'ap-southeast-2';
    try {
        if (event.body && Buffer.byteLength(event.body, 'utf8') > MAX_BODY_BYTES) {
            return { statusCode: 413, body: JSON.stringify({ message: 'Request body is too large' }) };
        }

        const router = new Router(
            event,
            region,
            [
                {
                    controller: DefaultController,
                    services: [OrganisationService, ContactFormService, ContactSubmissionService],
                },
            ],
            '/contacts',
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

// Same withOpenCORS shape as queries-api's routes (see queries-api/branding/app.ts): reflects
// whatever Origin the request sent instead of a static allow-list, since this route is called from an
// open, growing set of client site domains that can't be enumerated in advance. Unlike queries-api
// this one also allows POST, the visitor's form submit.
function withOpenCORS(
    handler: (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>,
): (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult> {
    return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
        const origin = event.headers?.origin || event.headers?.Origin || '';
        const corsHeaders = {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
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
