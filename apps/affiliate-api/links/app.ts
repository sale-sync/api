// Affiliate API, links domain: GET/POST /affiliates/links.
// One Lambda per resource (domain-driven, least privilege, isolation, smaller bundles). Reads and writes link records and address reservations; reads referrals for link results.
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Router, withCORS } from '@devyethiha/samjs';
import LinksController from './links.controller';
import { LinkService } from './link.service';
import { ALLOWED_ORIGINS, tooLarge } from '../shared/http';

async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    try {
        if (tooLarge(event.body)) return { statusCode: 413, body: JSON.stringify({ message: 'Request body is too large' }) };
        const router = new Router(event, 'ap-southeast-2', [{ controller: LinksController, services: [LinkService] }], '/affiliates');
        return await router.handle();
    } catch (err) {
        console.log({ err });
        return { statusCode: 500, body: JSON.stringify({ message: 'some error happened' }) };
    }
}

export const lambdaHandler = withCORS(main, ALLOWED_ORIGINS);
