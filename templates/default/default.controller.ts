import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods, isAuthorize, UNAUTHORIZE_ERROR, ValidationError } from '@devyethiha/samjs';
import { TemplateService } from '../services/template.service';
import { CreateTemplateDTO } from '../dtos/create-template.dto';
import type { BusinessCategory } from '@sale-sync/shared/src/types';

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

    // POST /templates — TODO: restrict to admin once admin tooling exists; any authenticated user can write for now
    async post(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        try {
            const dto = new CreateTemplateDTO();
            const body = dto.validate(JSON.parse(event.body || '{}'));

            const template = await this.templateService.createTemplate({
                name: body.name,
                business_category: body.business_category,
                preview_image: body.preview_image,
            });

            return {
                statusCode: 201,
                body: JSON.stringify(template),
            };
        } catch (error) {
            if (error instanceof ValidationError) {
                return {
                    statusCode: 400,
                    body: JSON.stringify({
                        message: error.message,
                        issues: error.issues,
                    }),
                };
            }
            throw error;
        }
    }
}

export default DefaultController;
