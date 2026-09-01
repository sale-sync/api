import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods } from '@devyethiha/samjs';
import { getOrganisationFromBearerToken, NO_ORGANISATION } from '@sale-sync/shared';
import { OrganisationService } from '../services/organisation.service';
import { AgentsService } from '../services/agents.service';

class DefaultController extends Controller implements IControllerMethods {
    private organisationService: OrganisationService;
    private agentsService: AgentsService;

    constructor(organisationService: OrganisationService, agentsService: AgentsService) {
        super('default');
        this.organisationService = organisationService;
        this.agentsService = agentsService;
    }

    // GET /agents — no slug/path param. Organisation comes from an `Authorization: Bearer <jwt>`
    // header the client site attaches itself, same mechanism branding/testimonials use.
    // Deliberately no isAuthorize() call — public, unauthenticated route like every other
    // queries-api route. Returns [] (not 404) when the org has no designated agents — an empty
    // list is a normal state for a site that hasn't set any up yet, not an error.
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        const organisation = getOrganisationFromBearerToken(event);
        if (!organisation?.uuid) return NO_ORGANISATION;

        const org = await this.organisationService.getByUuid(organisation.uuid);
        if (!org) return { statusCode: 404, body: JSON.stringify({ message: 'Organisation not found' }) };

        const agents = await this.agentsService.getPublicAgents(organisation.uuid);

        return {
            statusCode: 200,
            body: JSON.stringify(agents),
        };
    }
}

export default DefaultController;
