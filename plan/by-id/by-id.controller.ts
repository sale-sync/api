import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods, isAuthorize, UNAUTHORIZE_ERROR } from '@devyethiha/samjs';
import { PlanService } from '../services/plan.service';

class ByIdController extends Controller implements IControllerMethods {
    private planService: PlanService;

    constructor(planService: PlanService) {
        super('by-id');
        this.planService = planService;
    }

    // GET /plans/by-id?id={plan_id slug}
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        const id = event.queryStringParameters?.id;
        if (!id) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'Missing required query parameter: id' }),
            };
        }

        const plan = await this.planService.getPlanById(id);
        if (!plan) {
            return {
                statusCode: 404,
                body: JSON.stringify({ message: `Plan '${id}' not found` }),
            };
        }

        return {
            statusCode: 200,
            body: JSON.stringify(plan),
        };
    }
}

export default ByIdController;
