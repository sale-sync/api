import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods } from '@devyethiha/samjs';
import { getOrganisationFromBearerToken, NO_ORGANISATION } from '@sale-sync/shared';
import { OrganisationService } from '../services/organisation.service';
import { ArticlesService } from '../services/articles.service';

class DefaultController extends Controller implements IControllerMethods {
    private organisationService: OrganisationService;
    private articlesService: ArticlesService;

    constructor(organisationService: OrganisationService, articlesService: ArticlesService) {
        super('default');
        this.organisationService = organisationService;
        this.articlesService = articlesService;
    }

    // GET /articles — no slug/path param (both the listing and the client site's /articles/<slug>
    // detail page fetch this same payload and filter client-side, same reasoning as
    // locations/about/testimonials returning one blob per page load). Organisation comes from an
    // `Authorization: Bearer <jwt>` header the client site attaches itself. Deliberately no
    // isAuthorize() call — same public, unauthenticated shape as every other queries-api route.
    // Only ever returns the published articles list (`articles.data`), never `articles.draft`.
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        const organisation = getOrganisationFromBearerToken(event);
        if (!organisation?.uuid) return NO_ORGANISATION;

        const org = await this.organisationService.getByUuid(organisation.uuid);
        if (!org) return { statusCode: 404, body: JSON.stringify({ message: 'Organisation not found' }) };

        const articles = await this.articlesService.get(organisation.uuid);
        if (!articles.data) {
            return { statusCode: 200, body: JSON.stringify({ articles: [] }) };
        }

        return {
            statusCode: 200,
            body: JSON.stringify(articles.data),
        };
    }
}

export default DefaultController;
