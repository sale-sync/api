import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods, isAuthorize, UNAUTHORIZE_ERROR } from '@devyethiha/samjs';
import { WebsiteTemplateService } from '../../services/website-template.service';

class ThemeController extends Controller implements IControllerMethods {
    private websiteTemplateService: WebsiteTemplateService;

    constructor(websiteTemplateService: WebsiteTemplateService) {
        super('templates/theme');
        this.websiteTemplateService = websiteTemplateService;
    }

    // GET /organisations/templates/theme?templateUuid={uuid}                    → list every predefined theme for a template
    // GET /organisations/templates/theme?templateUuid={uuid}&themeUuid={uuid}   → a single predefined theme
    // Read-only, staff-curated catalog (WebsiteTable) — not an org's own theme, which is its
    // BrandingRecord (see BrandingController). No auth-role gate beyond being signed in: this is
    // catalog browsing, same as GET /organisations/templates?category=.
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        const { templateUuid, themeUuid } = event.queryStringParameters ?? {};

        if (!templateUuid) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'Missing required query parameter: templateUuid' }),
            };
        }

        if (themeUuid) {
            const theme = await this.websiteTemplateService.getTheme(templateUuid, themeUuid);
            if (!theme) {
                return { statusCode: 404, body: JSON.stringify({ message: 'Theme not found' }) };
            }
            return { statusCode: 200, body: JSON.stringify(theme) };
        }

        const themes = await this.websiteTemplateService.listThemesByTemplate(templateUuid);
        return { statusCode: 200, body: JSON.stringify(themes) };
    }
}

export default ThemeController;
