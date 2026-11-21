import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
    Controller,
    IControllerMethods,
    isAuthorize,
    UNAUTHORIZE_ERROR,
    ValidationError,
} from '@devyethiha/samjs';
import { SubscriptionAlreadyExistsError, SubscriptionService } from '../services/subscription.service';
import { CreateSubscriptionSchema, UpdateSubscriptionSchema } from '@sale-sync/shared/src/dtos';

class SubscriptionController extends Controller implements IControllerMethods {
    private subscriptionService: SubscriptionService;

    constructor(subscriptionService: SubscriptionService) {
        super('subscription');
        this.subscriptionService = subscriptionService;
    }

    // GET /payments/subscription?organisation_id={uuid}
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        const organisationId = event.queryStringParameters?.organisation_id;
        if (!organisationId) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Missing required query parameter: organisation_id' }) };
        }

        const subscription = await this.subscriptionService.getSubscriptionByOrganisationId(organisationId);
        if (!subscription) {
            return { statusCode: 404, body: JSON.stringify({ message: `Subscription for organisation '${organisationId}' not found` }) };
        }

        return { statusCode: 200, body: JSON.stringify(subscription) };
    }

    // POST /payments/subscription — create the singleton subscription/trial record for an org
    async post(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        try {
            const result = CreateSubscriptionSchema.safeParse(JSON.parse(event.body || '{}'));
            if (!result.success) {
                throw new ValidationError('Validation failed', result.error.issues);
            }

            const subscription = await this.subscriptionService.createSubscription(result.data);
            return { statusCode: 201, body: JSON.stringify(subscription) };
        } catch (error) {
            if (error instanceof ValidationError) {
                return { statusCode: 400, body: JSON.stringify({ message: error.message, issues: error.issues }) };
            }
            if (error instanceof SubscriptionAlreadyExistsError) {
                return { statusCode: 409, body: JSON.stringify({ message: error.message }) };
            }
            throw error;
        }
    }

    // PATCH /payments/subscription — status transitions (e.g. past_due -> active on manual payment), plan/trial changes
    async patch(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        try {
            const result = UpdateSubscriptionSchema.safeParse(JSON.parse(event.body || '{}'));
            if (!result.success) {
                throw new ValidationError('Validation failed', result.error.issues);
            }

            const updated = await this.subscriptionService.updateSubscription(result.data);
            if (!updated) {
                return {
                    statusCode: 404,
                    body: JSON.stringify({ message: `Subscription for organisation '${result.data.organisation_id}' not found` }),
                };
            }

            return { statusCode: 200, body: JSON.stringify(updated) };
        } catch (error) {
            if (error instanceof ValidationError) {
                return { statusCode: 400, body: JSON.stringify({ message: error.message, issues: error.issues }) };
            }
            throw error;
        }
    }
}

export default SubscriptionController;
