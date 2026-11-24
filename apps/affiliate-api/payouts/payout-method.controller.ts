import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods } from '@devyethiha/samjs';
import { isResponse, signedInUser } from '../shared/affiliate';
import { errorResponse, json, parseBody } from '../shared/http';
import { PayoutService } from './payout.service';
import { PayoutMethodDTO } from './dtos';

// /affiliates/payout-method: Stripe, or a bank transfer from the company account. Only the last 4 digits come back.
class PayoutMethodController extends Controller implements IControllerMethods {
    private payoutService: PayoutService;

    constructor(payoutService: PayoutService) {
        super('payout-method');
        this.payoutService = payoutService;
    }

    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        const user = await signedInUser(event); // the verified sign-in (auth.ts)
        if (isResponse(user)) return user;
        try {
            return json(200, { method: await this.payoutService.getMethod(user.id) });
        } catch (error) {
            return errorResponse(error);
        }
    }

    // PUT /affiliates/payout-method { kind: 'stripe' } | { kind: 'bank', accountName, bank, branch, accountNumber }
    async put(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        // payouts are their own backlog (blocked until the company's ABN): production stores no bank details before then
        if (process.env.AFFILIATE_STAGE === 'production') return json(403, { code: 'PAYOUTS_NOT_OPEN', message: 'Payouts are not open yet' });
        const user = await signedInUser(event);
        if (isResponse(user)) return user;
        try {
            const input = new PayoutMethodDTO().validate(parseBody(event.body));
            return json(200, { method: await this.payoutService.setMethod(user.id, input) });
        } catch (error) {
            return errorResponse(error);
        }
    }
}

export default PayoutMethodController;
