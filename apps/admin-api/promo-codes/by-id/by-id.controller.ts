import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods, isAuthorize, UNAUTHORIZE_ERROR } from '@devyethiha/samjs';
import { PromoCodeRedeemedError, PromoCodeService } from '../services/promo-code.service';

class ByIdController extends Controller implements IControllerMethods {
    private promoCodeService: PromoCodeService;

    constructor(promoCodeService: PromoCodeService) {
        super('by-id');
        this.promoCodeService = promoCodeService;
    }

    // GET /promo-codes/by-id?id={uuid}
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        const id = event.queryStringParameters?.id;
        if (!id) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Missing required query parameter: id' }) };
        }

        const promoCode = await this.promoCodeService.getPromoCodeByUuid(id);
        if (!promoCode) {
            return { statusCode: 404, body: JSON.stringify({ message: `Promo code '${id}' not found` }) };
        }

        return { statusCode: 200, body: JSON.stringify(promoCode) };
    }

    // DELETE /promo-codes/by-id?id={uuid} — rejected with 409 if the code has already been redeemed
    async delete(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        const id = event.queryStringParameters?.id;
        if (!id) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Missing required query parameter: id' }) };
        }

        try {
            const deleted = await this.promoCodeService.deletePromoCode(id);
            if (!deleted) {
                return { statusCode: 404, body: JSON.stringify({ message: `Promo code '${id}' not found` }) };
            }

            return { statusCode: 200, body: JSON.stringify({ message: `Promo code '${id}' deleted` }) };
        } catch (error) {
            if (error instanceof PromoCodeRedeemedError) {
                return { statusCode: 409, body: JSON.stringify({ message: error.message }) };
            }
            throw error;
        }
    }
}

export default ByIdController;
