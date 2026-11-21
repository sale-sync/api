import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods } from '@devyethiha/samjs';
import { getOrganisationFromBearerToken, NO_ORGANISATION } from '@sale-sync/shared';
import { OrganisationService } from '../services/organisation.service';
import { AboutService } from '../services/about.service';

class DefaultController extends Controller implements IControllerMethods {
    private organisationService: OrganisationService;
    private aboutService: AboutService;

    constructor(organisationService: OrganisationService, aboutService: AboutService) {
        super('default');
        this.organisationService = organisationService;
        this.aboutService = aboutService;
    }

    // GET /about — no slug/path param. Organisation comes from an `Authorization: Bearer <jwt>`
    // header the client site attaches itself, same mechanism branding/testimonials use. Deliberately
    // no isAuthorize() call — same public, unauthenticated shape as every other queries-api route.
    // Only ever returns the published about content (`about.data`), never `about.draft`.
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        const organisation = getOrganisationFromBearerToken(event);
        if (!organisation?.uuid) return NO_ORGANISATION;

        const org = await this.organisationService.getByUuid(organisation.uuid);
        if (!org) return { statusCode: 404, body: JSON.stringify({ message: 'Organisation not found' }) };

        const about = await this.aboutService.get(organisation.uuid);
        if (!about.data) {
            return { statusCode: 404, body: JSON.stringify({ message: 'About page not found' }) };
        }

        return {
            statusCode: 200,
            body: JSON.stringify(about.data),
        };
    }
}

export default DefaultController;
