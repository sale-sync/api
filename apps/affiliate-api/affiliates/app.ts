// Affiliate API (backlog affiliate-api): one Lambda under /affiliates. Data in DynamoDB (store/dynamo-store.ts, table from
// AFFILIATE_TABLE_NAME), with two sample affiliates written on first use. No Cognito yet (user, 2026-11-24). Who is calling comes from samjs isAuthorize()/getUser(): the Authentication and
// Identifier cookies, the latter an ID token whose `sub` is the user id; the affiliate Cognito pool will issue them.
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Router, withCORS } from '@devyethiha/samjs';
import DefaultController from './default/default.controller';
import ApplicationController from './application/application.controller';
import LinksController from './links/links.controller';
import ReferralsController from './referrals/referrals.controller';
import PayoutsController from './payouts/payouts.controller';
import PayoutMethodController from './payout-method/payout-method.controller';
import ProgrammeController from './programme/programme.controller';
import { AffiliateService } from './services/affiliate.service';
import { LinkService } from './services/link.service';
import { ReferralService } from './services/referral.service';
import { PayoutService } from './services/payout.service';
import { ProgrammeService } from './services/programme.service';

// Small JSON bodies only (an application, a link, a payout method); anything bigger is refused before parsing.
const MAX_BODY_BYTES = 16 * 1024;

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
                // services order = each controller's constructor parameter order
                { controller: DefaultController, services: [AffiliateService, PayoutService] },
                { controller: ApplicationController, services: [AffiliateService] },
                { controller: LinksController, services: [LinkService] },
                { controller: ReferralsController, services: [ReferralService] },
                { controller: PayoutsController, services: [PayoutService] },
                { controller: PayoutMethodController, services: [PayoutService] },
                { controller: ProgrammeController, services: [ProgrammeService] },
            ],
            '/affiliates',
        );
        return await router.handle();
    } catch (err) {
        console.log({ err });
        return { statusCode: 500, body: JSON.stringify({ message: 'some error happened' }) };
    }
}

// The affiliate app: production, staging, local dev (vite, port 3280).
export const lambdaHandler = withCORS(main, [
    'https://affiliate.silastech.co',
    'https://staging-affiliate.silastech.co',
    'http://localhost:3280',
    'http://127.0.0.1:3280',
]);
