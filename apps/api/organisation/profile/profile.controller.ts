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
import { OrganisationService, ProfileNotFoundError } from '../services/organisation.service';
import { UpdateProfileDTO } from '../dtos/update-profile.dto';

class ProfileController extends Controller implements IControllerMethods {
    private organisationService: OrganisationService;

    constructor(organisationService: OrganisationService) {
        super('profile');
        this.organisationService = organisationService;
    }

    // GET /organisations/profile → the caller's own profile within the active organisation
    // (phone/bio/timezone/avatar from the membership record, name/email from Cognito).
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) {
            return UNAUTHORIZE_ERROR;
        }

        const user = getUser(event);
        if (!user) {
            return NO_USER;
        }

        const organisation = getOrganisation(event);
        if (!organisation) {
            return NO_ORGANISATION;
        }

        const profile = await this.organisationService.getProfile(organisation.uuid, organisation.user_id);
        if (!profile) {
            return {
                statusCode: 404,
                body: JSON.stringify({ message: 'No membership record found for this organisation/user' }),
            };
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                ...profile,
                name: user.name,
                email: user.email,
            }),
        };
    }

    // PATCH /organisations/profile → update the caller's own phone/bio/timezone/avatar within the
    // active organisation. No owner/admin restriction — every member manages their own profile.
    async patch(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) {
            return UNAUTHORIZE_ERROR;
        }

        const organisation = getOrganisation(event);
        if (!organisation) {
            return NO_ORGANISATION;
        }

        try {
            const body = new UpdateProfileDTO().validate(JSON.parse(event.body || '{}'));
            const updated = await this.organisationService.updateProfile(organisation.uuid, organisation.user_id, body);

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
            if (error instanceof ProfileNotFoundError) {
                return {
                    statusCode: 404,
                    body: JSON.stringify({ message: error.message }),
                };
            }
            throw error;
        }
    }
}

export default ProfileController;
