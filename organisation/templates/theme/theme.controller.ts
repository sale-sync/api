import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods, isAuthorize, UNAUTHORIZE_ERROR, ValidationError } from '@devyethiha/samjs';
import { TemplateMembershipNotFoundError, TemplateService } from '../../services/template.service';
import { UpdateThemeDTO } from '../dtos/update-theme.dto';

class ThemeController extends Controller implements IControllerMethods {
    private templateService: TemplateService;

    constructor(templateService: TemplateService) {
        super('templates/theme');
        this.templateService = templateService;
    }

    // GET /organisations/templates/theme?orgUuid={uuid}&templateUuid={uuid}
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        const { orgUuid, templateUuid } = event.queryStringParameters ?? {};

        if (!orgUuid || !templateUuid) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'Missing required query parameters: orgUuid, templateUuid' }),
            };
        }

        const theme = await this.templateService.getTheme(orgUuid, templateUuid);
        if (!theme) {
            return { statusCode: 404, body: JSON.stringify({ message: 'Theme not found' }) };
        }

        return { statusCode: 200, body: JSON.stringify(theme) };
    }

    // PATCH /organisations/templates/theme → update brand color and/or font
    async patch(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        try {
            const body = new UpdateThemeDTO().validate(JSON.parse(event.body || '{}'));
            const updated = await this.templateService.updateTheme(body.org_uuid, body.template_uuid, {
                brand_color: body.brand_color,
                font: body.font,
            });
            return { statusCode: 200, body: JSON.stringify(updated) };
        } catch (error) {
            if (error instanceof ValidationError) {
                return { statusCode: 400, body: JSON.stringify({ message: error.message, issues: error.issues }) };
            }
            if (error instanceof TemplateMembershipNotFoundError) {
                return { statusCode: 404, body: JSON.stringify({ message: (error as Error).message }) };
            }
            throw error;
        }
    }
}

export default ThemeController;
