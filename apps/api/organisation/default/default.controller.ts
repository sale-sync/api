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
import { getOrganisation, NO_ORGANISATION } from '@sale-sync/shared';
import { InsufficientRoleError, OrganisationService } from '../services/organisation.service';
import { SignupRequestAlreadyExistsError, SignupRequestService } from '../services/signup-request.service';
import { CreateOrganisationDTO } from '../dtos/create-organisation.dto';
import { UpdateOrganisationDTO } from '../dtos/update-organisation.dto';

class DefaultController extends Controller implements IControllerMethods {
    private organisationService!: OrganisationService;
    private signupRequestService!: SignupRequestService;

    constructor(organisationService: OrganisationService, signupRequestService: SignupRequestService) {
        super('default');
        this.organisationService = organisationService;
        this.signupRequestService = signupRequestService;
    }

    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) {
            return UNAUTHORIZE_ERROR;
        }
        const user = getUser(event);
        if (!user) {
            return NO_USER;
        }

        const data = await this.organisationService.getOrganisationsByUserId(user.id);

        return {
            statusCode: 200,
            body: JSON.stringify(data),
        };
    }

    async post(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) {
            return UNAUTHORIZE_ERROR;
        }
        const user = getUser(event);
        if (!user) {
            return NO_USER;
        }

        try {
            const dto = new CreateOrganisationDTO();
            const body = dto.validate(JSON.parse(event.body || '{}'));

            // Organisation creation is gated behind admin approval (backlogs/onboarding/children/
            // organisation-approval-gate) — this no longer creates a live org/membership/subscription
            // or invokes init-website; it only records a pending SignupRequest for an admin to
            // approve/reject via admin-api. The real org is created by
            // createOrganisationFromApprovedRequest() on approval.
            const signupRequest = await this.signupRequestService.createSignupRequest({
                user_id: user.id,
                user_email: user.email,
                organisation_id: body.organisation_id,
                organisation_name: body.organisation_name,
                business_category: body.business_category,
                template_id: body.template_id,
                plan_id: body.plan_id,
                description: body.description,
                address: body.address,
                market: body.market,
            });

            return {
                statusCode: 202,
                body: JSON.stringify({
                    signup_request_id: signupRequest.uuid,
                    organisation_id: signupRequest.organisation_id,
                    organisation_name: signupRequest.organisation_name,
                    status: signupRequest.status,
                }),
            };
        } catch (error) {
            if (error instanceof ValidationError) {
                return {
                    statusCode: 400,
                    body: JSON.stringify({
                        message: error.message,
                        issues: error.issues,
                    }),
                };
            }
            if (error instanceof SignupRequestAlreadyExistsError) {
                return {
                    statusCode: 409,
                    body: JSON.stringify({
                        message: error.message,
                    }),
                };
            }
            throw error;
        }
    }

    // PATCH /organisations → update the organisation's profile (name/description/address), from the
    // Organisation cookie. Restricted to owner/admin.
    async patch(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) {
            return UNAUTHORIZE_ERROR;
        }

        const organisation = getOrganisation(event);
        if (!organisation) {
            return NO_ORGANISATION;
        }

        try {
            const body = new UpdateOrganisationDTO().validate(JSON.parse(event.body || '{}'));
            const updated = await this.organisationService.updateOrganisation(organisation.uuid, body, organisation.user_id);

            return {
                statusCode: 200,
                body: JSON.stringify(updated),
            };
        } catch (error) {
            if (error instanceof ValidationError) {
                return {
                    statusCode: 400,
                    body: JSON.stringify({
                        message: error.message,
                        issues: error.issues,
                    }),
                };
            }
            if (error instanceof InsufficientRoleError) {
                return {
                    statusCode: 403,
                    body: JSON.stringify({
                        message: error.message,
                    }),
                };
            }
            throw error;
        }
    }
}

export default DefaultController;
