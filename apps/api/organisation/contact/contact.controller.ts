import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods, isAuthorize, UNAUTHORIZE_ERROR, ValidationError } from '@devyethiha/samjs';
import { getOrganisation, NO_ORGANISATION } from '@sale-sync/shared';
import { InsufficientRoleError, OrganisationService } from '../services/organisation.service';
import { ContactService, NoDraftToPublishError } from '../services/contact.service';
import { UpdateContactDraftDTO } from './contact.dto';

class ContactController extends Controller implements IControllerMethods {
    private organisationService: OrganisationService;
    private contactService: ContactService;

    constructor(organisationService: OrganisationService, contactService: ContactService) {
        super('contact');
        this.organisationService = organisationService;
        this.contactService = contactService;
    }

    // GET /organisations/contact — no role gate, any org member can view the current record.
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) {
            return UNAUTHORIZE_ERROR;
        }

        const organisation = getOrganisation(event);
        if (!organisation) {
            return NO_ORGANISATION;
        }

        const record = await this.contactService.get(organisation.uuid);

        return {
            statusCode: 200,
            body: JSON.stringify(record),
        };
    }

    // PATCH /organisations/contact — merge-updates the draft's `title`/`subtitle`/`businessInfo`/`seo` (each
    // independently optional — see ContactService.updateDraft()'s own comment). Restricted to
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

            const body = new UpdateContactDraftDTO().validate(JSON.parse(event.body || '{}'));
            const updated = await this.contactService.updateDraft(organisation.uuid, {
                title: body.title,
                subtitle: body.subtitle,
                businessInfo: body.businessInfo,
                seo: body.seo,
            });

            return {
                statusCode: 200,
                body: JSON.stringify(updated),
            };
        } catch (error) {
            return this.handleError(error);
        }
    }

    // POST /organisations/contact — publish (draft -> data). Restricted to owner/admin.
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

            // Optional body: { rebake: true } from the editor (see ContactService.publish()). Only a
            // literal `true` counts; anything else, including no body, is the plain publish.
            let rebake = false;
            if (event.body) {
                try {
                    rebake = JSON.parse(event.body)?.rebake === true;
                } catch {
                    rebake = false;
                }
            }

            const updated = await this.contactService.publish(organisation.uuid, { rebake });

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

export default ContactController;
