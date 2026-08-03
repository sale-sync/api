import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
    Controller,
    IControllerMethods,
    isAuthorize,
    UNAUTHORIZE_ERROR,
    ValidationError,
} from '@devyethiha/samjs';
import { PlanAlreadyExistsError, PlanService } from '../services/plan.service';
import { CreatePlanSchema, UpdatePlanSchema } from '@sale-sync/shared/src/dtos';

class DefaultController extends Controller implements IControllerMethods {
    private planService: PlanService;

    constructor(planService: PlanService) {
        super('default');
        this.planService = planService;
    }

    // GET /payments
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        const plans = await this.planService.listPlans();
        return { statusCode: 200, body: JSON.stringify(plans) };
    }

    // POST /payments
    async post(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        try {
            const result = CreatePlanSchema.safeParse(JSON.parse(event.body || '{}'));
            if (!result.success) {
                throw new ValidationError('Validation failed', result.error.issues);
            }

            const uuid = await this.planService.createPlan(result.data);
            return {
                statusCode: 201,
                body: JSON.stringify({ message: 'Plan created', uuid }),
            };
        } catch (error) {
            if (error instanceof ValidationError) {
                return { statusCode: 400, body: JSON.stringify({ message: error.message, issues: error.issues }) };
            }
            if (error instanceof PlanAlreadyExistsError) {
                return { statusCode: 409, body: JSON.stringify({ message: error.message }) };
            }
            throw error;
        }
    }

    // PATCH /payments
    async patch(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        try {
            const result = UpdatePlanSchema.safeParse(JSON.parse(event.body || '{}'));
            if (!result.success) {
                throw new ValidationError('Validation failed', result.error.issues);
            }

            const existing = await this.planService.getPlanByUuid(result.data.uuid);
            if (!existing) {
                return { statusCode: 404, body: JSON.stringify({ message: `Plan '${result.data.uuid}' not found` }) };
            }

            await this.planService.updatePlan(result.data);
            return { statusCode: 200, body: JSON.stringify({ message: 'Plan updated' }) };
        } catch (error) {
            if (error instanceof ValidationError) {
                return { statusCode: 400, body: JSON.stringify({ message: error.message, issues: error.issues }) };
            }
            throw error;
        }
    }
}

export default DefaultController;
