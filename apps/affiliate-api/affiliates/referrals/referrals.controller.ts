import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, getUser, IControllerMethods, isAuthorize, NO_USER, UNAUTHORIZE_ERROR } from '@devyethiha/samjs';
import { ReferralService } from '../services/referral.service';
import { isStatus } from '../domain/rules';
import { errorResponse, json } from '../default/http';

// /affiliates/referrals?status=trial|pending|subscribed|ended
class ReferralsController extends Controller implements IControllerMethods {
    private referralService: ReferralService;

    constructor(referralService: ReferralService) {
        super('referrals');
        this.referralService = referralService;
    }

    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;
        const user = getUser(event);
        if (!user?.id) return NO_USER;
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
