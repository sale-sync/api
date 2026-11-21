import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods } from '@devyethiha/samjs';
import {
    buildContactSubmissionSchema,
    currencyForMarket,
    DEFAULT_DIAL_MARKET,
    dialCodeForMarket,
    getOrganisationFromBearerToken,
    NO_ORGANISATION,
    toContactSubmissionValues,
} from '@sale-sync/shared';
import type { Organisation, PublicContactForm } from '@sale-sync/shared/src/types';
import { OrganisationService } from '../services/organisation.service';
import { ContactFormService } from '../services/contact-form.service';
import { ContactSubmissionService } from '../services/contact-submission.service';

class DefaultController extends Controller implements IControllerMethods {
    private organisationService: OrganisationService;
    private contactFormService: ContactFormService;
    private contactSubmissionService: ContactSubmissionService;

    constructor(
        organisationService: OrganisationService,
        contactFormService: ContactFormService,
        contactSubmissionService: ContactSubmissionService,
    ) {
        super('default');
        this.organisationService = organisationService;
        this.contactFormService = contactFormService;
        this.contactSubmissionService = contactSubmissionService;
    }

    // Both handlers are public and unauthenticated by design (a website visitor has no account), so
    // there is deliberately no isAuthorize() call, same as every queries-api route. The organisation
    // comes only from the `Authorization: Bearer <jwt>` header the client site attaches (the same
    // mechanism queries-api uses), never from the query string or the body, and it must be an
    // organisation that exists. Everything read or written below is keyed by that org's uuid, which
    // is what keeps each organisation's form and submissions separate.
    private async resolveOrganisation(event: APIGatewayProxyEvent): Promise<Organisation | null> {
        const organisation = getOrganisationFromBearerToken(event);
        if (!organisation?.uuid) return null;
        return this.organisationService.getByUuid(organisation.uuid);
    }

    // GET /contacts — the organisation's Contact Us form definition, which the client site builds its
    // form (and its validation) from, plus the phone country and currency its fields start on.
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        const org = await this.resolveOrganisation(event);
        if (!org) return NO_ORGANISATION;

        const body: PublicContactForm = {
            fields: await this.contactFormService.getFields(org.uuid),
            dialCode: dialCodeForMarket(org.market),
            country: org.market ?? DEFAULT_DIAL_MARKET,
            currency: currencyForMarket(org.market),
        };

        return { statusCode: 200, body: JSON.stringify(body) };
    }

    // POST /contacts — a visitor's submit. Body: { [fieldId]: string }. Validated against the form
    // as it is stored right now, not against anything the client sent, so a tampered or stale page
    // cannot add fields, skip required ones or pick an option that is not offered.
    async post(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        const org = await this.resolveOrganisation(event);
        if (!org) return NO_ORGANISATION;

        let payload: unknown;
        try {
            payload = JSON.parse(event.body || '{}');
        } catch {
            return { statusCode: 400, body: JSON.stringify({ message: 'Request body must be valid JSON' }) };
        }

        const fields = await this.contactFormService.getFields(org.uuid);
        const parsed = buildContactSubmissionSchema(fields).safeParse(payload);
        if (!parsed.success) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    message: 'Validation failed',
                    issues: parsed.error.issues.map((issue) => ({
                        path: issue.path.join('.'),
                        message: issue.message,
                    })),
                }),
            };
        }

        const values = toContactSubmissionValues(fields, parsed.data, dialCodeForMarket(org.market));
        if (values.every((entry) => entry.value === '')) {
            return { statusCode: 400, body: JSON.stringify({ message: 'The form is empty' }) };
        }

        const submission = await this.contactSubmissionService.create(org.uuid, values);

        // Only what the page needs to show a confirmation; the stored record stays server-side.
        return {
            statusCode: 201,
            body: JSON.stringify({ id: submission.id, submitted_at: submission.submitted_at }),
        };
    }
}

export default DefaultController;
