import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods, isAuthorize, UNAUTHORIZE_ERROR } from '@devyethiha/samjs';
import { getOrganisation, NO_ORGANISATION } from '@sale-sync/shared';
import { OrganisationService } from '../services/organisation.service';

class UsersController extends Controller implements IControllerMethods {
    private organisationService: OrganisationService;

    constructor(organisationService: OrganisationService) {
        super('users');
        this.organisationService = organisationService;
    }

    // GET /organisations/users                  → list all users in the organisation (from the Organisation cookie)
    // GET /organisations/users?email={email}    → lookup user by email
    // GET /organisations/users?userId={userId}  → lookup user by user_id
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) {
            return UNAUTHORIZE_ERROR;
        }

        const { email, userId } = event.queryStringParameters ?? {};

        if (email) {
            const user = await this.organisationService.getUserByEmail(email);
            if (!user) {
                return {
                    statusCode: 404,
                    body: JSON.stringify({ message: `User with email '${email}' not found` }),
                };
            }
            return {
                statusCode: 200,
                body: JSON.stringify(user),
            };
        }

        if (userId) {
            const user = await this.organisationService.getUserById(userId);
            if (!user) {
                return {
                    statusCode: 404,
                    body: JSON.stringify({ message: `User '${userId}' not found` }),
                };
            }
            return {
                statusCode: 200,
                body: JSON.stringify(user),
            };
        }

        const organisation = getOrganisation(event);
        if (!organisation) {
            return NO_ORGANISATION;
        }

        const users = await this.organisationService.getUsersByOrganisationUuid(organisation.uuid);
        const usersWithEmail = await Promise.all(
            users.map(async (u) => ({
                ...u,
                email: (await this.organisationService.getUserById(u.user_id))?.email ?? '',
            })),
        );
        return {
            statusCode: 200,
            body: JSON.stringify(usersWithEmail),
        };
    }
}

export default UsersController;
