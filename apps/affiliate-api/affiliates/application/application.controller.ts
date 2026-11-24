import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods } from '@devyethiha/samjs';
import { isResponse, signedInUser } from '../../shared/affiliate';
import { errorResponse, json, parseBody } from '../../shared/http';
import { AffiliateService } from '../affiliate.service';
import { ApplicationDTO } from '../dtos';

// /affiliates/application: apply once, with the market (fixed from then on). The team reviews it (review flow not built yet).
class ApplicationController extends Controller implements IControllerMethods {
    private affiliateService: AffiliateService;

    constructor(affiliateService: AffiliateService) {
        super('application');
        this.affiliateService = affiliateService;
    }

    // GET /affiliates/application: the application and its stage (pending or approved)
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        const user = signedInUser(event);
        if (isResponse(user)) return user;
        try {
            const a = await this.affiliateService.get(user.id);
            return json(200, { market: a.market, stage: a.stage, appliedOn: a.appliedOn });
        } catch (error) {
            return errorResponse(error);
        }
    }

    // POST /affiliates/application: 201 pending; 409 ALREADY_APPLIED for a second one (one market per affiliate)
    async post(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        const user = signedInUser(event);
        if (isResponse(user)) return user;
        try {
            const input = new ApplicationDTO().validate(parseBody(event.body));
            return json(201, { affiliate: await this.affiliateService.apply(user.id, user.email, input) });
        } catch (error) {
            return errorResponse(error);
        }
    }
}

export default ApplicationController;
