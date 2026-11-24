// Affiliate API, payouts domain: GET /affiliates/payouts, GET/PUT /affiliates/payout-method.
// One Lambda per resource (domain-driven, least privilege, isolation, smaller bundles). Writes the payout method (bank details stay in this Lambda); reads referrals and links for earnings.
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Router, withCORS } from '@devyethiha/samjs';
import PayoutsController from './payouts.controller';
import PayoutMethodController from './payout-method.controller';
import { PayoutService } from './payout.service';
import { ALLOWED_ORIGINS, tooLarge } from '../shared/http';

async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    try {
        if (tooLarge(event.body)) return { statusCode: 413, body: JSON.stringify({ message: 'Request body is too large' }) };
        const router = new Router(event, 'ap-southeast-2', [{ controller: PayoutsController, services: [PayoutService] }, { controller: PayoutMethodController, services: [PayoutService] }], '/affiliates');
        return await router.handle();
    } catch (err) {
        console.log({ err });
        return { statusCode: 500, body: JSON.stringify({ message: 'some error happened' }) };
    }
}

export const lambdaHandler = withCORS(main, ALLOWED_ORIGINS);
