import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods } from '@devyethiha/samjs';
import { getOrganisationFromBearerToken, NO_ORGANISATION } from '@sale-sync/shared';
import { OrganisationService } from '../services/organisation.service';
import { LocationsService } from '../services/locations.service';

class DefaultController extends Controller implements IControllerMethods {
    private organisationService: OrganisationService;
    private locationsService: LocationsService;

    constructor(organisationService: OrganisationService, locationsService: LocationsService) {
        super('default');
        this.organisationService = organisationService;
        this.locationsService = locationsService;
    }

    // GET /locations — no slug/path param (both the listing and the client site's /locations/<slug>
    // detail page fetch this same payload and filter client-side, same reasoning as about/
    // testimonials returning one blob per page load). Organisation comes from an
    // `Authorization: Bearer <jwt>` header the client site attaches itself. Deliberately no
    // isAuthorize() call — same public, unauthenticated shape as every other queries-api route.
    // Only ever returns the published locations list (`locations.data`), never `locations.draft`.
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        const organisation = getOrganisationFromBearerToken(event);
        if (!organisation?.uuid) return NO_ORGANISATION;

        const org = await this.organisationService.getByUuid(organisation.uuid);
        if (!org) return { statusCode: 404, body: JSON.stringify({ message: 'Organisation not found' }) };

        const locations = await this.locationsService.get(organisation.uuid);
        if (!locations.data) {
            return { statusCode: 200, body: JSON.stringify({ locations: [] }) };
        }

        return {
            statusCode: 200,
            body: JSON.stringify(locations.data),
        };
    }
}

export default DefaultController;
