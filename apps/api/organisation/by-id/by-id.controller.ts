import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods, isAuthorize, UNAUTHORIZE_ERROR } from '@devyethiha/samjs';
import { OrganisationService } from '../services/organisation.service';

class ByIdController extends Controller implements IControllerMethods {
    private organisationService: OrganisationService;

    constructor(organisationService: OrganisationService) {
        super('by-id');
        this.organisationService = organisationService;
    }

    // GET /organisations/by-id?id={orgId}
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) {
            return UNAUTHORIZE_ERROR;
        }

        const id = event.queryStringParameters?.id;
        if (!id) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'Missing required query parameter: id' }),
            };
        }

        const org = await this.organisationService.getOrganisationById(id);
        if (!org) {
            return {
                statusCode: 404,
                body: JSON.stringify({ message: `Organisation '${id}' not found` }),
            };
        }

        return {
            statusCode: 200,
            body: JSON.stringify(org),
        };
    }
}

export default ByIdController;
