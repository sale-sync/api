import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods, ValidationError } from '@devyethiha/samjs';
import type { ContactFormField } from '@sale-sync/shared/src/types';
import { InsufficientRoleError, OrganisationService } from '../services/organisation.service';
import { InvalidJsonBodyError, isResponse, parseJsonBody, resolveMember } from '../services/member-guard';
import { ContactFormService } from '../services/contact-form.service';
import { UpdateContactFormDTO } from './contact-form.dto';

class ContactFormController extends Controller implements IControllerMethods {
    private organisationService: OrganisationService;
    private contactFormService: ContactFormService;

    constructor(organisationService: OrganisationService, contactFormService: ContactFormService) {
        super('contact-form');
        this.organisationService = organisationService;
        this.contactFormService = contactFormService;
    }

    // GET /organisations/contact-form — any org member can view the form. Returns the
    // default form (updated_at: null) until the org saves its own.
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        const member = await resolveMember(event, this.organisationService);
        if (isResponse(member)) return member;

        const record = await this.contactFormService.get(member.orgUuid);

        return {
            statusCode: 200,
            body: JSON.stringify(record),
        };
    }

    // PUT /organisations/contact-form — replaces the org's form definition (the whole field list, in
    // order). Live on save: there is no publish step. Restricted to owner/admin.
    async put(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        const member = await resolveMember(event, this.organisationService);
        if (isResponse(member)) return member;

        try {
            await this.organisationService.assertCanManageTeam(member.orgUuid, member.userId);

            const body = new UpdateContactFormDTO().validate(parseJsonBody(event));
            const updated = await this.contactFormService.save(member.orgUuid, body.fields as ContactFormField[]);

            return {
                statusCode: 200,
                body: JSON.stringify(updated),
            };
        } catch (error) {
            if (error instanceof InvalidJsonBodyError) {
                return { statusCode: 400, body: JSON.stringify({ message: error.message }) };
            }
            if (error instanceof ValidationError) {
                return {
                    statusCode: 400,
                    body: JSON.stringify({ message: error.message, issues: error.issues }),
                };
            }
            if (error instanceof InsufficientRoleError) {
                return { statusCode: 403, body: JSON.stringify({ message: error.message }) };
            }
            throw error;
        }
    }
}

export default ContactFormController;
