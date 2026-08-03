import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
    Controller,
    IControllerMethods,
    isAuthorize,
    UNAUTHORIZE_ERROR,
    ValidationError,
} from '@devyethiha/samjs';
import { PromoCodeAlreadyExistsError, PromoCodeService } from '../services/promo-code.service';
import { CreatePromoCodeSchema, UpdatePromoCodeSchema } from '@sale-sync/shared/src/dtos';

class DefaultController extends Controller implements IControllerMethods {
    private promoCodeService: PromoCodeService;

    constructor(promoCodeService: PromoCodeService) {
        super('default');
        this.promoCodeService = promoCodeService;
    }

    // GET /promo-codes
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        const promoCodes = await this.promoCodeService.listPromoCodes();
        return { statusCode: 200, body: JSON.stringify(promoCodes) };
    }

    // POST /promo-codes
    async post(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        try {
            const result = CreatePromoCodeSchema.safeParse(JSON.parse(event.body || '{}'));
            if (!result.success) {
                throw new ValidationError('Validation failed', result.error.issues);
            }

            const promoCode = await this.promoCodeService.createPromoCode(result.data);
            return { statusCode: 201, body: JSON.stringify(promoCode) };
        } catch (error) {
            if (error instanceof ValidationError) {
                return { statusCode: 400, body: JSON.stringify({ message: error.message, issues: error.issues }) };
            }
            if (error instanceof PromoCodeAlreadyExistsError) {
                return { statusCode: 409, body: JSON.stringify({ message: error.message }) };
            }
            throw error;
        }
    }

    // PATCH /promo-codes
    async patch(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        try {
            const result = UpdatePromoCodeSchema.safeParse(JSON.parse(event.body || '{}'));
            if (!result.success) {
                throw new ValidationError('Validation failed', result.error.issues);
            }

            const updated = await this.promoCodeService.updatePromoCode(result.data);
            if (!updated) {
                return { statusCode: 404, body: JSON.stringify({ message: `Promo code '${result.data.uuid}' not found` }) };
            }

            return { statusCode: 200, body: JSON.stringify(updated) };
        } catch (error) {
            if (error instanceof ValidationError) {
                return { statusCode: 400, body: JSON.stringify({ message: error.message, issues: error.issues }) };
            }
            throw error;
        }
    }
}

export default DefaultController;
