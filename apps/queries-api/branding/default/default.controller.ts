import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods } from '@devyethiha/samjs';
import { getOrganisationFromBearerToken, NO_ORGANISATION } from '@sale-sync/shared';
import { OrganisationService } from '../services/organisation.service';
import { BrandingService } from '../services/branding.service';

class DefaultController extends Controller implements IControllerMethods {
    private organisationService: OrganisationService;
    private brandingService: BrandingService;

    constructor(organisationService: OrganisationService, brandingService: BrandingService) {
        super('default');
        this.organisationService = organisationService;
        this.brandingService = brandingService;
    }

    // GET /branding — no slug/path param. Organisation comes from an `Authorization: Bearer
    // <jwt>` header the client site attaches itself (not a cookie — a deployed client site's own
    // domain shares no parent domain with queries-api's, so a cookie set on one is never sent to
    // the other; see wello-template-api-mapping backlog). Deliberately no isAuthorize() call —
    // this is the first genuinely public, unauthenticated route in the repo. Only ever returns
    // published branding (`branding.data`), never `branding.draft`.
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        const organisation = getOrganisationFromBearerToken(event);
        if (!organisation?.uuid) return NO_ORGANISATION;

        const org = await this.organisationService.getByUuid(organisation.uuid);
        if (!org) return { statusCode: 404, body: JSON.stringify({ message: 'Organisation not found' }) };

        const branding = await this.brandingService.get(organisation.uuid);

        return {
            statusCode: 200,
            body: JSON.stringify({
                name: org.name,
                market: org.market,
                logo: branding.data?.logo ?? null,
                primaryColor: branding.data?.primaryColor ?? null,
                secondaryColor: branding.data?.secondaryColor ?? null,
            }),
        };
    }
}

export default DefaultController;
