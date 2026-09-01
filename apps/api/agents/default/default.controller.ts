import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods, isAuthorize, UNAUTHORIZE_ERROR, ValidationError } from '@devyethiha/samjs';
import { getOrganisation, NO_ORGANISATION } from '@sale-sync/shared';
import {
    AgentDesignationNotAllowedError,
    InsufficientRoleError,
    OrganisationService,
} from '../../organisation/services/organisation.service';
import { AgentAlreadyLinkedError, AgentsService, TargetNotTeamMemberError } from '../services/agents.service';
import { CreateAgentDTO } from '../dtos/create-agent.dto';

class DefaultController extends Controller implements IControllerMethods {
    private agentsService: AgentsService;
    private organisationService: OrganisationService;

    constructor(agentsService: AgentsService, organisationService: OrganisationService) {
        super('default');
        this.agentsService = agentsService;
        this.organisationService = organisationService;
    }

    // GET /agents — list every agent profile for the caller's organisation. No owner/admin gate,
    // same stance as GET /organisations/testimonials — any authenticated org member can view.
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        const organisation = getOrganisation(event);
        if (!organisation) return NO_ORGANISATION;

        const agents = await this.agentsService.listAgents(organisation.uuid);
        return { statusCode: 200, body: JSON.stringify(agents) };
    }

    // POST /agents — create a standalone agent profile, optionally linked to an existing team
    // member's user_id at creation time. Owner/admin + real-estate only (enforced in the service).
    async post(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        const organisation = getOrganisation(event);
        if (!organisation) return NO_ORGANISATION;

        try {
            const input = new CreateAgentDTO().validate(JSON.parse(event.body || '{}'));
            const agent = await this.agentsService.createAgent(
                organisation.uuid,
                input,
                organisation.user_id,
                this.organisationService,
            );
            return { statusCode: 201, body: JSON.stringify(agent) };
        } catch (error) {
            if (error instanceof ValidationError) {
                return { statusCode: 400, body: JSON.stringify({ message: error.message, issues: error.issues }) };
            }
            if (error instanceof InsufficientRoleError) {
                return { statusCode: 403, body: JSON.stringify({ message: error.message }) };
            }
            if (error instanceof AgentDesignationNotAllowedError) {
                return { statusCode: 422, body: JSON.stringify({ message: error.message }) };
            }
            if (error instanceof TargetNotTeamMemberError) {
                return { statusCode: 404, body: JSON.stringify({ message: error.message }) };
            }
            if (error instanceof AgentAlreadyLinkedError) {
                return { statusCode: 409, body: JSON.stringify({ message: error.message }) };
            }
            throw error;
        }
    }
}

export default DefaultController;
