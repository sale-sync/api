// Affiliate API, clicks domain: POST /affiliates/clicks (an affiliate link opened at silastech.co/r/<slug>).
// One Lambda per resource (domain-driven, least privilege, isolation, smaller bundles). Called server to server by the
// affiliate app's Worker, never from a browser, so no CORS origins.
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Router, withCORS } from '@devyethiha/samjs';
import ClicksController from './clicks.controller';
import { ClickService } from './click.service';
import { tooLarge } from '../shared/http';

async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    try {
        if (tooLarge(event.body)) return { statusCode: 413, body: JSON.stringify({ message: 'Request body is too large' }) };
        const router = new Router(event, 'ap-southeast-2', [{ controller: ClicksController, services: [ClickService] }], '/affiliates');
        return await router.handle();
    } catch (err) {
        console.log({ err });
        return { statusCode: 500, body: JSON.stringify({ message: 'some error happened' }) };
    }
}

export const lambdaHandler = withCORS(main, []);
