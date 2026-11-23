import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, getUser, IControllerMethods, isAuthorize, NO_USER, UNAUTHORIZE_ERROR } from '@devyethiha/samjs';
import { AffiliateService } from '../services/affiliate.service';
import { PayoutService } from '../services/payout.service';
import { ProfileDTO } from '../dtos';
import { errorResponse, json, parseBody } from './http';

// /affiliates: the signed-in affiliate (who, which market, pending or approved) and their profile.
// The user is the `sub` of the ID token in the Identifier cookie (samjs getUser), as Cognito will issue it.
class DefaultController extends Controller implements IControllerMethods {
    private affiliateService: AffiliateService;
    private payoutService: PayoutService;

    constructor(affiliateService: AffiliateService, payoutService: PayoutService) {
        super('default');
        this.affiliateService = affiliateService;
        this.payoutService = payoutService;
    }

    // GET /affiliates: 404 NOT_AN_AFFILIATE when the user has not applied yet (the app sends them to /apply)
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;
        const user = getUser(event);
        if (!user?.id) return NO_USER;
        try {
            const affiliate = await this.affiliateService.get(user.id);
            return json(200, { affiliate, payoutMethod: await this.payoutService.getMethod(user.id) });
        } catch (error) {
            return errorResponse(error);
        }
    }

    // PUT /affiliates: first name, last name, phone (the email and the market do not change here)
    async put(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;
        const user = getUser(event);
        if (!user?.id) return NO_USER;
        try {
            const input = new ProfileDTO().validate(parseBody(event.body));
            return json(200, { affiliate: await this.affiliateService.updateProfile(user.id, input) });
        } catch (error) {
            return errorResponse(error);
        }
    }
}

export default DefaultController;
