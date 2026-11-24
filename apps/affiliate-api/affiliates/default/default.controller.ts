import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods } from '@devyethiha/samjs';
import { isResponse, signedInUser } from '../../shared/affiliate';
import { errorResponse, json, parseBody } from '../../shared/http';
import { AffiliateService } from '../affiliate.service';
import { ProfileDTO } from '../dtos';

// /affiliates: the signed-in affiliate (who, which market, pending or approved) and their profile.
class DefaultController extends Controller implements IControllerMethods {
    private affiliateService: AffiliateService;

    constructor(affiliateService: AffiliateService) {
        super('default');
        this.affiliateService = affiliateService;
    }

    // GET /affiliates: 404 NOT_AN_AFFILIATE when the user has not applied yet (the app sends them to /apply)
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        const user = signedInUser(event); // isAuthorize + getUser
        if (isResponse(user)) return user;
        try {
            return json(200, { affiliate: await this.affiliateService.get(user.id) });
        } catch (error) {
            return errorResponse(error);
        }
    }

    // PUT /affiliates: first name, last name, phone (the email and the market do not change here)
    async put(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        const user = signedInUser(event);
        if (isResponse(user)) return user;
        try {
            const input = new ProfileDTO().validate(parseBody(event.body));
            return json(200, { affiliate: await this.affiliateService.updateProfile(user.id, input) });
        } catch (error) {
            return errorResponse(error);
        }
    }
}

export default DefaultController;
