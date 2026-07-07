import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods, isAuthorize, UNAUTHORIZE_ERROR } from '@devyethiha/samjs';
import { TemplateService } from '../services/template.service';
import type { BusinessCategory } from '@sales-sync/shared/src/types';

const VALID_CATEGORIES: BusinessCategory[] = ['fitness', 'real-estate', 'service-business', 'restaurant', 'haircut-and-salon'];

class DefaultController extends Controller implements IControllerMethods {
    private templateService: TemplateService;

    constructor(templateService: TemplateService) {
        super('default');
        this.templateService = templateService;
    }

    // GET /templates?category={category}
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        const { category } = event.queryStringParameters ?? {};

        if (!category) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'category is required' }),
            };
        }

        if (!VALID_CATEGORIES.includes(category as BusinessCategory)) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}` }),
            };
        }

        const templates = await this.templateService.listByCategory(category as BusinessCategory);
        return {
            statusCode: 200,
            body: JSON.stringify(templates),
        };
    }
}

export default DefaultController;
