import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods } from '@devyethiha/samjs';
import { getOrganisationFromBearerToken, NO_ORGANISATION } from '@sale-sync/shared';
import { OrganisationService } from '../services/organisation.service';
import { TestimonialsService } from '../services/testimonials.service';

class DefaultController extends Controller implements IControllerMethods {
    private organisationService: OrganisationService;
    private testimonialsService: TestimonialsService;

    constructor(organisationService: OrganisationService, testimonialsService: TestimonialsService) {
        super('default');
        this.organisationService = organisationService;
        this.testimonialsService = testimonialsService;
    }

    // GET /testimonials — no slug/path param. Organisation comes from an `Authorization: Bearer
    // <jwt>` header the client site attaches itself, same mechanism branding/default.controller.ts
    // uses. Deliberately no isAuthorize() call — same public, unauthenticated shape as every other
    // queries-api route. Only ever returns published testimonials (`testimonials.data`), never
    // `testimonials.draft`.
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        const organisation = getOrganisationFromBearerToken(event);
        if (!organisation?.uuid) return NO_ORGANISATION;

        const org = await this.organisationService.getByUuid(organisation.uuid);
        if (!org) return { statusCode: 404, body: JSON.stringify({ message: 'Organisation not found' }) };

        const testimonials = await this.testimonialsService.get(organisation.uuid);
        if (!testimonials.data) {
            return { statusCode: 404, body: JSON.stringify({ message: 'Testimonials not found' }) };
        }

        return {
            statusCode: 200,
            body: JSON.stringify(testimonials.data),
        };
    }
}

export default DefaultController;
