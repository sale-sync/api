// Affiliate API, affiliates domain: the account (GET/PUT /affiliates) and the application (GET/POST /affiliates/application).
// One Lambda per resource (domain-driven, least privilege, isolation, smaller bundles): this one may write affiliate profiles
// and is the only one that writes the sample affiliates. Table: AFFILIATE_TABLE_NAME (owned by ss/infra).
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Router, withCORS } from '@devyethiha/samjs';
import DefaultController from './default/default.controller';
import ApplicationController from './application/application.controller';
import { AffiliateService } from './affiliate.service';
import { ALLOWED_ORIGINS, tooLarge } from '../shared/http';

async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    try {
        if (tooLarge(event.body)) return { statusCode: 413, body: JSON.stringify({ message: 'Request body is too large' }) };
        const router = new Router(
            event,
            'ap-southeast-2',
            [
                { controller: DefaultController, services: [AffiliateService] },
                { controller: ApplicationController, services: [AffiliateService] },
            ],
            '/affiliates',
        );
        return await router.handle();
    } catch (err) {
        console.log({ err });
        return { statusCode: 500, body: JSON.stringify({ message: 'some error happened' }) };
    }
}

export const lambdaHandler = withCORS(main, ALLOWED_ORIGINS);
