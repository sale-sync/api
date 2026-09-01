import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods, isAuthorize, UNAUTHORIZE_ERROR } from '@devyethiha/samjs';
import type { SignupRequest } from '@sale-sync/shared/src/types';
import { SignupRequestService } from '../services/signup-request.service';

class DefaultController extends Controller implements IControllerMethods {
    private signupRequestService: SignupRequestService;

    constructor(signupRequestService: SignupRequestService) {
        super('default');
        this.signupRequestService = signupRequestService;
    }

    // GET /signup-requests?status=pending|approved|rejected|all (default: pending)
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        const status = (event.queryStringParameters?.status as SignupRequest['status'] | 'all' | undefined) ?? 'pending';

        const items = await this.signupRequestService.listSignupRequests(status);
        return { statusCode: 200, body: JSON.stringify({ items }) };
    }
}

export default DefaultController;
