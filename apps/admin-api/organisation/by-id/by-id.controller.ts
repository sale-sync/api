import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
    Controller,
    IControllerMethods,
    isAuthorize,
    UNAUTHORIZE_ERROR,
    ValidationError,
} from '@devyethiha/samjs';
import { OrganisationService } from '../services/organisation.service';
import { AdminUpdateOrganisationSchema } from '@sale-sync/shared/src/dtos';

class ByIdController extends Controller implements IControllerMethods {
    private organisationService: OrganisationService;

    constructor(organisationService: OrganisationService) {
        super('by-id');
        this.organisationService = organisationService;
    }

    // GET /organisations/by-id?id={org_id slug}
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        const id = event.queryStringParameters?.id;
        if (!id) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Missing required query parameter: id' }) };
        }

        const org = await this.organisationService.getOrganisationById(id);
        if (!org) {
            return { statusCode: 404, body: JSON.stringify({ message: `Organisation '${id}' not found` }) };
        }

        return { statusCode: 200, body: JSON.stringify(org) };
    }

    // PATCH /organisations/by-id
    async patch(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        try {
            const result = AdminUpdateOrganisationSchema.safeParse(JSON.parse(event.body || '{}'));
            if (!result.success) {
                throw new ValidationError('Validation failed', result.error.issues);
            }

            const updated = await this.organisationService.updateOrganisation(result.data);
            if (!updated) {
                return { statusCode: 404, body: JSON.stringify({ message: `Organisation '${result.data.uuid}' not found` }) };
            }

            return { statusCode: 200, body: JSON.stringify({ message: 'Organisation updated' }) };
        } catch (error) {
            if (error instanceof ValidationError) {
                return { statusCode: 400, body: JSON.stringify({ message: error.message, issues: error.issues }) };
            }
            throw error;
        }
    }
}

export default ByIdController;
