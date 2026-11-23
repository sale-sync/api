import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, getUser, IControllerMethods, isAuthorize, NO_USER, UNAUTHORIZE_ERROR } from '@devyethiha/samjs';
import { PayoutService } from '../services/payout.service';
import { errorResponse, json } from '../default/http';

// /affiliates/payouts: earned, paid, unpaid (with the approximate US$ against the minimum), and one row per subscription.
class PayoutsController extends Controller implements IControllerMethods {
    private payoutService: PayoutService;

    constructor(payoutService: PayoutService) {
        super('payouts');
        this.payoutService = payoutService;
    }

    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;
        const user = getUser(event);
        if (!user?.id) return NO_USER;
        try {
            return json(200, await this.payoutService.summary(user.id));
        } catch (error) {
            return errorResponse(error);
        }
    }
}

export default PayoutsController;
