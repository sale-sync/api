// Affiliate API, referrals domain: GET /affiliates/referrals.
// One Lambda per resource (domain-driven, least privilege, isolation, smaller bundles). Read-only table access.
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Router, withCORS } from '@devyethiha/samjs';
import ReferralsController from './referrals.controller';
import { ReferralService } from './referral.service';
import { ALLOWED_ORIGINS, tooLarge } from '../shared/http';

async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    try {
        if (tooLarge(event.body)) return { statusCode: 413, body: JSON.stringify({ message: 'Request body is too large' }) };
        const router = new Router(event, 'ap-southeast-2', [{ controller: ReferralsController, services: [ReferralService] }], '/affiliates');
        return await router.handle();
    } catch (err) {
        console.log({ err });
        return { statusCode: 500, body: JSON.stringify({ message: 'some error happened' }) };
    }
}

export const lambdaHandler = withCORS(main, ALLOWED_ORIGINS);
