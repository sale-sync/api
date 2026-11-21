import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods, isAuthorize, UNAUTHORIZE_ERROR } from '@devyethiha/samjs';
import { OrganisationService } from '../services/organisation.service';

class DefaultController extends Controller implements IControllerMethods {
    private organisationService: OrganisationService;

    constructor(organisationService: OrganisationService) {
        super('default');
        this.organisationService = organisationService;
    }

    // GET /organisations?lastKey=META%23...&limit=50
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        const { lastKey, limit } = event.queryStringParameters ?? {};
        const parsedLimit = limit ? parseInt(limit, 10) : undefined;

        const result = await this.organisationService.listOrganisations(lastKey, parsedLimit);
        return { statusCode: 200, body: JSON.stringify(result) };
    }
}

export default DefaultController;
