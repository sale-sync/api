import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods, isAuthorize, UNAUTHORIZE_ERROR, ValidationError } from '@devyethiha/samjs';
import { getOrganisation, NO_ORGANISATION } from '@sale-sync/shared';
import { InsufficientRoleError, OrganisationService } from '../services/organisation.service';
import { FaqService, NoDraftToPublishError } from '../services/faq.service';
import { UpdateFaqDraftDTO } from './faq.dto';

class FaqController extends Controller implements IControllerMethods {
    private organisationService: OrganisationService;
    private faqService: FaqService;

    constructor(organisationService: OrganisationService, faqService: FaqService) {
        super('faq');
        this.organisationService = organisationService;
        this.faqService = faqService;
    }

    // GET /organisations/faq — no role gate, any org member can view the current record.
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) {
            return UNAUTHORIZE_ERROR;
        }

        const organisation = getOrganisation(event);
        if (!organisation) {
            return NO_ORGANISATION;
        }

        const record = await this.faqService.get(organisation.uuid);

        return {
            statusCode: 200,
            body: JSON.stringify(record),
        };
    }

    // PATCH /organisations/faq — replace the draft's full topics list (each carrying its own faqs).
    // Restricted to owner/admin.
    async patch(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) {
            return UNAUTHORIZE_ERROR;
        }

        const organisation = getOrganisation(event);
        if (!organisation) {
            return NO_ORGANISATION;
        }

        try {
            await this.organisationService.assertCanManageTeam(organisation.uuid, organisation.user_id);

            const body = new UpdateFaqDraftDTO().validate(JSON.parse(event.body || '{}'));
            const updated = await this.faqService.updateDraft(organisation.uuid, body.topics);

            return {
                statusCode: 200,
                body: JSON.stringify(updated),
            };
        } catch (error) {
            return this.handleError(error);
        }
    }

    // POST /organisations/faq — publish (draft -> data). Restricted to owner/admin.
    async post(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) {
            return UNAUTHORIZE_ERROR;
        }

        const organisation = getOrganisation(event);
        if (!organisation) {
            return NO_ORGANISATION;
        }

        try {
            await this.organisationService.assertCanManageTeam(organisation.uuid, organisation.user_id);

            const updated = await this.faqService.publish(organisation.uuid);

            return {
                statusCode: 200,
                body: JSON.stringify(updated),
            };
        } catch (error) {
            return this.handleError(error);
        }
    }

    private handleError(error: unknown): APIGatewayProxyResult {
        if (error instanceof ValidationError) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: error.message, issues: error.issues }),
            };
        }
        if (error instanceof InsufficientRoleError) {
            return { statusCode: 403, body: JSON.stringify({ message: error.message }) };
        }
        if (error instanceof NoDraftToPublishError) {
            return { statusCode: 409, body: JSON.stringify({ message: error.message }) };
        }
        throw error;
    }
}

export default FaqController;
