import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods } from '@devyethiha/samjs';
import { getOrganisationFromBearerToken, NO_ORGANISATION } from '@sale-sync/shared';
import { OrganisationService } from '../services/organisation.service';
import { PrivacyPolicyService } from '../services/privacy-policy.service';

class DefaultController extends Controller implements IControllerMethods {
    private organisationService: OrganisationService;
    private privacyPolicyService: PrivacyPolicyService;

    constructor(organisationService: OrganisationService, privacyPolicyService: PrivacyPolicyService) {
        super('default');
        this.organisationService = organisationService;
        this.privacyPolicyService = privacyPolicyService;
    }

    // GET /privacy-policy — no slug/path param. Organisation comes from an
    // `Authorization: Bearer <jwt>` header the client site attaches itself, same mechanism
    // branding/testimonials/about use. Deliberately no isAuthorize() call — same public,
    // unauthenticated shape as every other queries-api route. Only ever returns the published
    // content (`privacyPolicy.data`), never `privacyPolicy.draft`.
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        const organisation = getOrganisationFromBearerToken(event);
        if (!organisation?.uuid) return NO_ORGANISATION;

        const org = await this.organisationService.getByUuid(organisation.uuid);
        if (!org) return { statusCode: 404, body: JSON.stringify({ message: 'Organisation not found' }) };

        const privacyPolicy = await this.privacyPolicyService.get(organisation.uuid);
        if (!privacyPolicy.data) {
            return { statusCode: 404, body: JSON.stringify({ message: 'Privacy policy not found' }) };
        }

        return {
            statusCode: 200,
            body: JSON.stringify(privacyPolicy.data),
        };
    }
}

export default DefaultController;
