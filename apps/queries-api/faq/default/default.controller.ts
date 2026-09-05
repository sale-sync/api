import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods } from '@devyethiha/samjs';
import { getOrganisationFromBearerToken, NO_ORGANISATION } from '@sale-sync/shared';
import { OrganisationService } from '../services/organisation.service';
import { FaqService } from '../services/faq.service';

class DefaultController extends Controller implements IControllerMethods {
    private organisationService: OrganisationService;
    private faqService: FaqService;

    constructor(organisationService: OrganisationService, faqService: FaqService) {
        super('default');
        this.organisationService = organisationService;
        this.faqService = faqService;
    }

    // GET /faq — no path/query param, this always returns the org's whole FAQ payload (topics, each
    // with its own faqs) in one shot; the client site's sidebar+accordion UI filters to the active
    // topic client-side. Organisation comes from an `Authorization: Bearer <jwt>` header the client
    // site attaches itself. Deliberately no isAuthorize() call — same public, unauthenticated shape
    // as every other queries-api route. Only ever returns the published content (`faq.data`), never
    // `faq.draft`.
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        const organisation = getOrganisationFromBearerToken(event);
        if (!organisation?.uuid) return NO_ORGANISATION;

        const org = await this.organisationService.getByUuid(organisation.uuid);
        if (!org) return { statusCode: 404, body: JSON.stringify({ message: 'Organisation not found' }) };

        const faq = await this.faqService.get(organisation.uuid);
        if (!faq.data) {
            return { statusCode: 200, body: JSON.stringify({ topics: [] }) };
        }

        return {
            statusCode: 200,
            body: JSON.stringify(faq.data),
        };
    }
}

export default DefaultController;
