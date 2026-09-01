import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
    Controller,
    getUser,
    IControllerMethods,
    isAuthorize,
    NO_USER,
    UNAUTHORIZE_ERROR,
    ValidationError,
} from '@devyethiha/samjs';
import { SignupRequestActionSchema } from '@sale-sync/shared/src/dtos';
import {
    OrganisationAlreadyExistsError,
    SignupRequestAlreadyActionedError,
    SignupRequestNotFoundError,
    SignupRequestService,
} from '../services/signup-request.service';

class ByIdController extends Controller implements IControllerMethods {
    private signupRequestService: SignupRequestService;

    constructor(signupRequestService: SignupRequestService) {
        super('by-id');
        this.signupRequestService = signupRequestService;
    }

    // GET /signup-requests/by-id?id={uuid}
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        const id = event.queryStringParameters?.id;
        if (!id) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Missing required query parameter: id' }) };
        }

        const request = await this.signupRequestService.getSignupRequestById(id);
        if (!request) {
            return { statusCode: 404, body: JSON.stringify({ message: `Signup request '${id}' not found` }) };
        }

        return { statusCode: 200, body: JSON.stringify(request) };
    }

    // PATCH /signup-requests/by-id — body: { uuid, action: 'approve'|'reject', rejection_reason? }
    async patch(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;
        const reviewer = getUser(event);
        if (!reviewer) return NO_USER;

        try {
            const result = SignupRequestActionSchema.safeParse(JSON.parse(event.body || '{}'));
            if (!result.success) {
                throw new ValidationError('Validation failed', result.error.issues);
            }
            const { uuid, action, rejection_reason } = result.data;

            if (action === 'approve') {
                const organisation = await this.signupRequestService.approveSignupRequest(uuid, reviewer.id);
                return { statusCode: 200, body: JSON.stringify({ message: 'Signup request approved', organisation }) };
            }

            await this.signupRequestService.rejectSignupRequest(uuid, reviewer.id, rejection_reason!);
            return { statusCode: 200, body: JSON.stringify({ message: 'Signup request rejected' }) };
        } catch (error) {
            if (error instanceof ValidationError) {
                return { statusCode: 400, body: JSON.stringify({ message: error.message, issues: error.issues }) };
            }
            if (error instanceof SignupRequestNotFoundError) {
                return { statusCode: 404, body: JSON.stringify({ message: error.message }) };
            }
            if (error instanceof SignupRequestAlreadyActionedError) {
                return { statusCode: 409, body: JSON.stringify({ message: error.message }) };
            }
            if (error instanceof OrganisationAlreadyExistsError) {
                // Approval failed after the pending check — the request is left 'pending' (see
                // SignupRequestService.approveSignupRequest), surface the reason so the admin can
                // retry or reject instead of it looking like a silent no-op.
                return { statusCode: 409, body: JSON.stringify({ message: error.message }) };
            }
            throw error;
        }
    }
}

export default ByIdController;
