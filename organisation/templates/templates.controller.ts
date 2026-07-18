import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods, isAuthorize, UNAUTHORIZE_ERROR, ValidationError } from '@devyethiha/samjs';
import { getOrganisation, NO_ORGANISATION } from '@sale-sync/shared';
import { ActiveTemplateRemovalError, OrganisationNotFoundError, TemplateNotFoundError, TemplateMembershipNotFoundError, TemplateService } from '../services/template.service';
import { AddTemplateDTO } from './dtos/add-template.dto';
import { RemoveTemplateDTO } from './dtos/remove-template.dto';
import { SetActiveTemplateDTO } from './dtos/set-active-template.dto';
import type { BusinessCategory } from '@sale-sync/shared/src/types';

class TemplatesController extends Controller implements IControllerMethods {
    private templateService: TemplateService;

    constructor(templateService: TemplateService) {
        super('templates');
        this.templateService = templateService;
    }

    // GET /organisations/templates?category={category}  → list catalogue by business category
    // GET /organisations/templates                      → list the organisation's added templates (from the Organisation cookie)
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        const { category } = event.queryStringParameters ?? {};

        if (category) {
            const templates = await this.templateService.listByCategory(category as BusinessCategory);
            return { statusCode: 200, body: JSON.stringify(templates) };
        }

        const organisation = getOrganisation(event);
        if (!organisation) return NO_ORGANISATION;

        const templates = await this.templateService.listOrganisationTemplates(organisation.uuid);
        return { statusCode: 200, body: JSON.stringify(templates) };
    }

    // POST /organisations/templates → add template to org (optionally set as active)
    async post(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        const organisation = getOrganisation(event);
        if (!organisation) return NO_ORGANISATION;

        try {
            const body = new AddTemplateDTO().validate(JSON.parse(event.body || '{}'));
            await this.templateService.addToOrganisation(organisation.uuid, body.template_uuid, body.set_active);
            return { statusCode: 201, body: JSON.stringify({ message: 'Template added to organisation' }) };
        } catch (error) {
            if (error instanceof ValidationError) {
                return { statusCode: 400, body: JSON.stringify({ message: error.message, issues: error.issues }) };
            }
            if (error instanceof OrganisationNotFoundError || error instanceof TemplateNotFoundError) {
                return { statusCode: 404, body: JSON.stringify({ message: (error as Error).message }) };
            }
            throw error;
        }
    }

    // PATCH /organisations/templates → set active template
    async patch(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        const organisation = getOrganisation(event);
        if (!organisation) return NO_ORGANISATION;

        try {
            const body = new SetActiveTemplateDTO().validate(JSON.parse(event.body || '{}'));
            await this.templateService.setActive(organisation.uuid, body.template_uuid);
            return { statusCode: 200, body: JSON.stringify({ message: 'Active template updated' }) };
        } catch (error) {
            if (error instanceof ValidationError) {
                return { statusCode: 400, body: JSON.stringify({ message: error.message, issues: error.issues }) };
            }
            if (error instanceof OrganisationNotFoundError || error instanceof TemplateMembershipNotFoundError) {
                return { statusCode: 404, body: JSON.stringify({ message: (error as Error).message }) };
            }
            throw error;
        }
    }

    // DELETE /organisations/templates → remove template from org
    async delete(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        const organisation = getOrganisation(event);
        if (!organisation) return NO_ORGANISATION;

        try {
            const body = new RemoveTemplateDTO().validate(JSON.parse(event.body || '{}'));
            await this.templateService.removeFromOrganisation(organisation.uuid, body.template_uuid);
            return { statusCode: 200, body: JSON.stringify({ message: 'Template removed from organisation' }) };
        } catch (error) {
            if (error instanceof ValidationError) {
                return { statusCode: 400, body: JSON.stringify({ message: error.message, issues: error.issues }) };
            }
            if (error instanceof OrganisationNotFoundError) {
                return { statusCode: 404, body: JSON.stringify({ message: (error as Error).message }) };
            }
            if (error instanceof ActiveTemplateRemovalError) {
                return { statusCode: 409, body: JSON.stringify({ message: (error as Error).message }) };
            }
            throw error;
        }
    }
}

export default TemplatesController;
