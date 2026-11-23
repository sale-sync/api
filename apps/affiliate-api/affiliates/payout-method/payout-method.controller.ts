import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, getUser, IControllerMethods, isAuthorize, NO_USER, UNAUTHORIZE_ERROR } from '@devyethiha/samjs';
import { PayoutService } from '../services/payout.service';
import { PayoutMethodDTO } from '../dtos';
import { errorResponse, json, parseBody } from '../default/http';

// /affiliates/payout-method: Stripe, or a bank transfer from the company account. Only the last 4 digits come back.
class PayoutMethodController extends Controller implements IControllerMethods {
    private payoutService: PayoutService;

    constructor(payoutService: PayoutService) {
        super('payout-method');
        this.payoutService = payoutService;
    }

    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;
        const user = getUser(event);
        if (!user?.id) return NO_USER;
        try {
            return json(200, { method: await this.payoutService.getMethod(user.id) });
        } catch (error) {
            return errorResponse(error);
        }
    }

    // PUT /affiliates/payout-method { kind: 'stripe' } | { kind: 'bank', accountName, bank, branch, accountNumber }
    async put(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;
        const user = getUser(event);
        if (!user?.id) return NO_USER;
        try {
            const input = new PayoutMethodDTO().validate(parseBody(event.body));
            return json(200, { method: await this.payoutService.setMethod(user.id, input) });
        } catch (error) {
            return errorResponse(error);
        }
    }
}

export default PayoutMethodController;
