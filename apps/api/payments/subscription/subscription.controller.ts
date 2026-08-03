import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods, isAuthorize, UNAUTHORIZE_ERROR } from '@devyethiha/samjs';
import { SubscriptionService } from '../services/subscription.service';

class SubscriptionController extends Controller implements IControllerMethods {
    private subscriptionService: SubscriptionService;

    constructor(subscriptionService: SubscriptionService) {
        super('subscription');
        this.subscriptionService = subscriptionService;
    }

    // GET /payments/subscription?organisation_id={uuid} — the org's current trial/subscription state
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        const organisationId = event.queryStringParameters?.organisation_id;
        if (!organisationId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'Missing required query parameter: organisation_id' }),
            };
        }

        const subscription = await this.subscriptionService.getSubscriptionByOrganisationId(organisationId);
        if (!subscription) {
            return {
                statusCode: 404,
                body: JSON.stringify({ message: `Subscription for organisation '${organisationId}' not found` }),
            };
        }

        return {
            statusCode: 200,
            body: JSON.stringify(subscription),
        };
    }
}

export default SubscriptionController;
