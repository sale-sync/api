import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, getUser, IControllerMethods, isAuthorize, NO_USER, UNAUTHORIZE_ERROR } from '@devyethiha/samjs';
import { AffiliateService } from '../services/affiliate.service';
import { ApplicationDTO } from '../dtos';
import { errorResponse, json, parseBody } from '../default/http';

// /affiliates/application: apply once, with the market (fixed from then on). The team reviews it (review flow not built yet).
class ApplicationController extends Controller implements IControllerMethods {
    private affiliateService: AffiliateService;

    constructor(affiliateService: AffiliateService) {
        super('application');
        this.affiliateService = affiliateService;
    }

    // GET /affiliates/application: the application and its stage (pending or approved)
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;
        const user = getUser(event);
        if (!user?.id) return NO_USER;
        try {
            const a = await this.affiliateService.get(user.id);
            return json(200, { market: a.market, stage: a.stage, appliedOn: a.appliedOn });
        } catch (error) {
            return errorResponse(error);
        }
    }

    // POST /affiliates/application: 201 pending; 409 ALREADY_APPLIED for a second one (one market per affiliate)
    async post(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;
        const user = getUser(event);
        if (!user?.id) return NO_USER;
        try {
            const input = new ApplicationDTO().validate(parseBody(event.body));
            return json(201, { affiliate: await this.affiliateService.apply(user.id, user.email, input) });
        } catch (error) {
            return errorResponse(error);
        }
    }
}

export default ApplicationController;
