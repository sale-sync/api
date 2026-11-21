import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods, isAuthorize, UNAUTHORIZE_ERROR, ValidationError } from '@devyethiha/samjs';
import { getOrganisation, NO_ORGANISATION } from '@sale-sync/shared';
import {
    AgentDesignationNotAllowedError,
    InsufficientRoleError,
    OrganisationService,
} from '../../organisation/services/organisation.service';
import {
    AgentAlreadyLinkedError,
    AgentNotFoundError,
    AgentsService,
    TargetNotTeamMemberError,
} from '../services/agents.service';
import { LinkAgentDTO } from '../dtos/link-agent.dto';

class LinkController extends Controller implements IControllerMethods {
    private agentsService: AgentsService;
    private organisationService: OrganisationService;

    constructor(agentsService: AgentsService, organisationService: OrganisationService) {
        super('link'); // → /agents/link
        this.agentsService = agentsService;
        this.organisationService = organisationService;
    }

    // POST /agents/link — body { agent_id, user_id | null }. user_id: null unlinks. Owner/admin +
    // real-estate only. Rejects if user_id isn't an actual member of the org, or is already linked
    // to a different agent.
    async post(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        const organisation = getOrganisation(event);
        if (!organisation) return NO_ORGANISATION;

        try {
            const body = new LinkAgentDTO().validate(JSON.parse(event.body || '{}'));
            const agent = await this.agentsService.linkAgent(
                organisation.uuid,
                body.agent_id,
                body.user_id,
                organisation.user_id,
                this.organisationService,
            );
            return { statusCode: 200, body: JSON.stringify(agent) };
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
            if (error instanceof AgentNotFoundError || error instanceof TargetNotTeamMemberError) {
                return { statusCode: 404, body: JSON.stringify({ message: error.message }) };
            }
            if (error instanceof AgentAlreadyLinkedError) {
                return { statusCode: 409, body: JSON.stringify({ message: error.message }) };
            }
            throw error;
        }
    }
}

export default LinkController;
