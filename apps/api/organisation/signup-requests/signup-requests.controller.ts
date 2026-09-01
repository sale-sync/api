import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, getUser, IControllerMethods, isAuthorize, NO_USER, UNAUTHORIZE_ERROR } from '@devyethiha/samjs';
import { SignupRequestService } from '../services/signup-request.service';

class SignupRequestsController extends Controller implements IControllerMethods {
    private signupRequestService!: SignupRequestService;

    constructor(signupRequestService: SignupRequestService) {
        super('signup-requests');
        this.signupRequestService = signupRequestService;
    }

    // GET /organisations/signup-requests — the caller's own signup requests (any status), so the
    // web-app wizard can render "you already have a pending request" on repeat visits / after
    // logout-login.
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) {
            return UNAUTHORIZE_ERROR;
        }
        const user = getUser(event);
        if (!user) {
            return NO_USER;
        }

        const data = await this.signupRequestService.getSignupRequestsByUserId(user.id);

        return {
            statusCode: 200,
            body: JSON.stringify(data),
        };
    }
}

export default SignupRequestsController;
