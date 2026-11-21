import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods, isAuthorize, UNAUTHORIZE_ERROR, ValidationError } from '@devyethiha/samjs';
import { getOrganisation, NO_ORGANISATION } from '@sale-sync/shared';
import { InsufficientRoleError, OrganisationService } from '../services/organisation.service';
import { TermsAndConditionsService, NoDraftToPublishError } from '../services/terms-and-conditions.service';
import { UpdateTermsAndConditionsDraftDTO } from './terms-and-conditions.dto';

class TermsAndConditionsController extends Controller implements IControllerMethods {
    private organisationService: OrganisationService;
    private termsAndConditionsService: TermsAndConditionsService;

    constructor(organisationService: OrganisationService, termsAndConditionsService: TermsAndConditionsService) {
        super('terms-and-conditions');
        this.organisationService = organisationService;
        this.termsAndConditionsService = termsAndConditionsService;
    }

    // GET /organisations/terms-and-conditions — no role gate, any org member can view the current
    // record.
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) {
            return UNAUTHORIZE_ERROR;
        }

        const organisation = getOrganisation(event);
        if (!organisation) {
            return NO_ORGANISATION;
        }

        const record = await this.termsAndConditionsService.get(organisation.uuid);

        return {
            statusCode: 200,
            body: JSON.stringify(record),
        };
    }

    // PATCH /organisations/terms-and-conditions — replace the draft's BlockNote document.
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

            const body = new UpdateTermsAndConditionsDraftDTO().validate(JSON.parse(event.body || '{}'));
            const updated = await this.termsAndConditionsService.updateDraft(organisation.uuid, body.blocks, body.seo);

            return {
                statusCode: 200,
                body: JSON.stringify(updated),
            };
        } catch (error) {
            return this.handleError(error);
        }
    }

    // POST /organisations/terms-and-conditions — publish (draft -> data). Restricted to owner/admin.
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

            const updated = await this.termsAndConditionsService.publish(organisation.uuid);

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

export default TermsAndConditionsController;
