import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods } from '@devyethiha/samjs';
import { isResponse, signedInUser } from '../shared/affiliate';
import { errorResponse, json } from '../shared/http';
import { isStatus } from '../shared/rules';
import { ReferralService } from './referral.service';

// /affiliates/referrals?status=trial|pending|subscribed|ended
class ReferralsController extends Controller implements IControllerMethods {
    private referralService: ReferralService;

    constructor(referralService: ReferralService) {
        super('referrals');
        this.referralService = referralService;
    }

    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        const user = await signedInUser(event); // the verified sign-in (auth.ts)
        if (isResponse(user)) return user;
        const { status } = event.queryStringParameters ?? {};
        if (status !== undefined && !isStatus(status)) return json(400, { message: 'status must be trial, pending, subscribed or ended' });
        try {
            return json(200, { referrals: await this.referralService.list(user.id, status) });
        } catch (error) {
            return errorResponse(error);
        }
    }
}

export default ReferralsController;
