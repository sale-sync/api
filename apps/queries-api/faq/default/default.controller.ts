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
    // with its own resolved faqs) in one shot; the client site's sidebar+accordion UI filters to the
    // active topic client-side. Organisation comes from an `Authorization: Bearer <jwt>` header the
    // client site attaches itself. Deliberately no isAuthorize() call — same public, unauthenticated
    // shape as every other queries-api route. Only ever returns the published content (`faq.data`),
    // never `faq.draft`.
    //
    // The underlying record is now two flat, related lists (`topics`, `faqs` with `topicIds` — see
    // backlogs/real-estate-template/children/faq-many-to-many-topics), but the join is resolved
    // HERE, server-side, so the response shape stays topic-nested exactly as before — the client
    // renderer (actions/faq.ts) needs zero changes, since a question assigned to N topics simply
    // appears (duplicated) in each of those N topics' resolved `faqs` arrays.
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        const organisation = getOrganisationFromBearerToken(event);
        if (!organisation?.uuid) return NO_ORGANISATION;

        const org = await this.organisationService.getByUuid(organisation.uuid);
        if (!org) return { statusCode: 404, body: JSON.stringify({ message: 'Organisation not found' }) };

        const faq = await this.faqService.get(organisation.uuid);
        if (!faq.data) {
            return { statusCode: 200, body: JSON.stringify({ topics: [] }) };
        }

        const resolvedTopics = faq.data.topics.map((topic) => ({
            ...topic,
            faqs: faq.data!.faqs.filter((entry) => entry.topicIds.includes(topic.id)),
        }));

        return {
            statusCode: 200,
            body: JSON.stringify({ topics: resolvedTopics }),
        };
    }
}

export default DefaultController;
