import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods, isAuthorize, UNAUTHORIZE_ERROR, ValidationError } from '@devyethiha/samjs';
import { getOrganisation, NO_ORGANISATION } from '@sale-sync/shared';
import { InsufficientRoleError, OrganisationService } from '../services/organisation.service';
import { PrivacyPolicyService, NoDraftToPublishError } from '../services/privacy-policy.service';
import { UpdatePrivacyPolicyDraftDTO } from './privacy-policy.dto';

class PrivacyPolicyController extends Controller implements IControllerMethods {
    private organisationService: OrganisationService;
    private privacyPolicyService: PrivacyPolicyService;

    constructor(organisationService: OrganisationService, privacyPolicyService: PrivacyPolicyService) {
        super('privacy-policy');
        this.organisationService = organisationService;
        this.privacyPolicyService = privacyPolicyService;
    }

    // GET /organisations/privacy-policy — no role gate, any org member can view the current record.
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) {
            return UNAUTHORIZE_ERROR;
        }

        const organisation = getOrganisation(event);
        if (!organisation) {
            return NO_ORGANISATION;
        }

        const record = await this.privacyPolicyService.get(organisation.uuid);

        return {
            statusCode: 200,
            body: JSON.stringify(record),
        };
    }

    // PATCH /organisations/privacy-policy — replace the draft's BlockNote document. Restricted to
    // owner/admin.
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

            const body = new UpdatePrivacyPolicyDraftDTO().validate(JSON.parse(event.body || '{}'));
            const updated = await this.privacyPolicyService.updateDraft(organisation.uuid, body.blocks, body.seo);

            return {
                statusCode: 200,
                body: JSON.stringify(updated),
            };
        } catch (error) {
            return this.handleError(error);
        }
    }

    // POST /organisations/privacy-policy — publish (draft -> data). Restricted to owner/admin.
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

            const updated = await this.privacyPolicyService.publish(organisation.uuid);

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

export default PrivacyPolicyController;
