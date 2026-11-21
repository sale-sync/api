import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods } from '@devyethiha/samjs';
import { getOrganisationFromBearerToken, NO_ORGANISATION } from '@sale-sync/shared';
import { OrganisationService } from '../services/organisation.service';
import { TermsAndConditionsService } from '../services/terms-and-conditions.service';

class DefaultController extends Controller implements IControllerMethods {
    private organisationService: OrganisationService;
    private termsAndConditionsService: TermsAndConditionsService;

    constructor(organisationService: OrganisationService, termsAndConditionsService: TermsAndConditionsService) {
        super('default');
        this.organisationService = organisationService;
        this.termsAndConditionsService = termsAndConditionsService;
    }

    // GET /terms-and-conditions — no slug/path param. Organisation comes from an
    // `Authorization: Bearer <jwt>` header the client site attaches itself, same mechanism
    // branding/testimonials/about use. Deliberately no isAuthorize() call — same public,
    // unauthenticated shape as every other queries-api route. Only ever returns the published
    // content (`termsAndConditions.data`), never `termsAndConditions.draft`.
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        const organisation = getOrganisationFromBearerToken(event);
        if (!organisation?.uuid) return NO_ORGANISATION;

        const org = await this.organisationService.getByUuid(organisation.uuid);
        if (!org) return { statusCode: 404, body: JSON.stringify({ message: 'Organisation not found' }) };

        const termsAndConditions = await this.termsAndConditionsService.get(organisation.uuid);
        if (!termsAndConditions.data) {
            return { statusCode: 404, body: JSON.stringify({ message: 'Terms & conditions not found' }) };
        }

        return {
            statusCode: 200,
            body: JSON.stringify(termsAndConditions.data),
        };
    }
}

export default DefaultController;
