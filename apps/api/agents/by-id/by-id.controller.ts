import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods, isAuthorize, UNAUTHORIZE_ERROR, ValidationError } from '@devyethiha/samjs';
import { getOrganisation, NO_ORGANISATION } from '@sale-sync/shared';
import {
    AgentDesignationNotAllowedError,
    InsufficientRoleError,
    OrganisationService,
} from '../../organisation/services/organisation.service';
import { AgentNotFoundError, AgentsService } from '../services/agents.service';
import { UpdateAgentDTO } from '../dtos/update-agent.dto';

class ByIdController extends Controller implements IControllerMethods {
    private agentsService: AgentsService;
    private organisationService: OrganisationService;

    constructor(agentsService: AgentsService, organisationService: OrganisationService) {
        super('by-id'); // → /agents/by-id — samjs is query-string-only routing, never a {path} param
        this.agentsService = agentsService;
        this.organisationService = organisationService;
    }

    // GET /agents/by-id?id={id}
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        const organisation = getOrganisation(event);
        if (!organisation) return NO_ORGANISATION;

        const { id } = event.queryStringParameters ?? {};
        if (!id) return { statusCode: 400, body: JSON.stringify({ message: 'Missing query param: id' }) };

        const agent = await this.agentsService.getAgent(organisation.uuid, id);
        if (!agent) return { statusCode: 404, body: JSON.stringify({ message: 'Agent not found' }) };
        return { statusCode: 200, body: JSON.stringify(agent) };
    }

    // PATCH /agents/by-id?id={id} — update name/position/photo. Owner/admin + real-estate only.
    async patch(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        const organisation = getOrganisation(event);
        if (!organisation) return NO_ORGANISATION;

        const { id } = event.queryStringParameters ?? {};
        if (!id) return { statusCode: 400, body: JSON.stringify({ message: 'Missing query param: id' }) };

        try {
            const patch = new UpdateAgentDTO().validate(JSON.parse(event.body || '{}'));
            const agent = await this.agentsService.updateAgent(
                organisation.uuid,
                id,
                patch,
                organisation.user_id,
                this.organisationService,
            );
            return { statusCode: 200, body: JSON.stringify(agent) };
        } catch (error) {
            return this.handleError(error);
        }
    }

    // DELETE /agents/by-id?id={id}. Owner/admin + real-estate only.
    async delete(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        const organisation = getOrganisation(event);
        if (!organisation) return NO_ORGANISATION;

        const { id } = event.queryStringParameters ?? {};
        if (!id) return { statusCode: 400, body: JSON.stringify({ message: 'Missing query param: id' }) };

        try {
            await this.agentsService.deleteAgent(organisation.uuid, id, organisation.user_id, this.organisationService);
            return { statusCode: 200, body: JSON.stringify({ message: 'Agent deleted' }) };
        } catch (error) {
            return this.handleError(error);
        }
    }

    private handleError(error: unknown): APIGatewayProxyResult {
        if (error instanceof ValidationError) {
            return { statusCode: 400, body: JSON.stringify({ message: error.message, issues: error.issues }) };
        }
        if (error instanceof InsufficientRoleError) {
            return { statusCode: 403, body: JSON.stringify({ message: error.message }) };
        }
        if (error instanceof AgentDesignationNotAllowedError) {
            return { statusCode: 422, body: JSON.stringify({ message: error.message }) };
        }
        if (error instanceof AgentNotFoundError) {
            return { statusCode: 404, body: JSON.stringify({ message: error.message }) };
        }
        throw error;
    }
}

export default ByIdController;
