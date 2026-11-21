import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods, isAuthorize, UNAUTHORIZE_ERROR } from '@devyethiha/samjs';
import { PlanService } from '../services/plan.service';

class DefaultController extends Controller implements IControllerMethods {
    private planService: PlanService;

    constructor(planService: PlanService) {
        super('default');
        this.planService = planService;
    }

    // GET /payments — list the plan catalogue (Basic/Pro tiers)
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        const plans = await this.planService.listPlans();
        return {
            statusCode: 200,
            body: JSON.stringify(plans),
        };
    }
}

export default DefaultController;
