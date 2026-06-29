import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods, isAuthorize, UNAUTHORIZE_ERROR } from '@devyethiha/samjs';
import { OrganisationService } from '../services/organisation.service';

class UsersController extends Controller implements IControllerMethods {
    private organisationService: OrganisationService;

    constructor(organisationService: OrganisationService) {
        super('users');
        this.organisationService = organisationService;
    }

    // GET /organisations/users?orgUuid={uuid}   → list all users in an organisation
    // GET /organisations/users?email={email}    → lookup user by email
    // GET /organisations/users?userId={userId}  → lookup user by user_id
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) {
            return UNAUTHORIZE_ERROR;
        }

        const { orgUuid, email, userId } = event.queryStringParameters ?? {};

        if (orgUuid) {
            const users = await this.organisationService.getUsersByOrganisationUuid(orgUuid);
            return {
                statusCode: 200,
                body: JSON.stringify(users),
            };
        }

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

        return {
            statusCode: 400,
            body: JSON.stringify({ message: 'Provide one of: orgUuid, email, userId' }),
        };
    }
}

export default UsersController;
