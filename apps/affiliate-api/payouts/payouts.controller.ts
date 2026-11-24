import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods } from '@devyethiha/samjs';
import { isResponse, signedInUser } from '../shared/affiliate';
import { errorResponse, json } from '../shared/http';
import { PayoutService } from './payout.service';

// /affiliates/payouts: earned, paid, unpaid (with the approximate US$ against the minimum), and one row per subscription.
class PayoutsController extends Controller implements IControllerMethods {
    private payoutService: PayoutService;

    constructor(payoutService: PayoutService) {
        super('payouts');
        this.payoutService = payoutService;
    }

    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        const user = signedInUser(event); // isAuthorize + getUser
        if (isResponse(user)) return user;
        try {
            return json(200, await this.payoutService.summary(user.id));
        } catch (error) {
            return errorResponse(error);
        }
    }
}

export default PayoutsController;
