import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods, isAuthorize, UNAUTHORIZE_ERROR, ValidationError } from '@devyethiha/samjs';
import { getOrganisation, NO_ORGANISATION } from '@sale-sync/shared';
import {
    ConcurrentModificationError,
    PropertyNotFoundError,
    PropertyNotPublishedError,
    PropertyService,
    UnitNotFoundError,
} from '../services/property.service';
import { PublishPropertyDTO } from '../dtos/publish-property.dto';

const json = (statusCode: number, body: unknown): APIGatewayProxyResult => ({ statusCode, body: JSON.stringify(body) });

class PublishController extends Controller implements IControllerMethods {
    private propertyService: PropertyService;

    constructor(propertyService: PropertyService) {
        super('publish');
        this.propertyService = propertyService;
    }

    // POST /properties/publish → publish a property's draft (body: property_uuid), or just one unit's
    // (body: property_uuid + unit_uuid). Publishing copies the draft onto the live copy the public
    // website reads, and starts the page generation for exactly what was published.
    async post(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        const organisation = getOrganisation(event);
        if (!organisation) return NO_ORGANISATION;

        try {
            const { property_uuid, unit_uuid } = new PublishPropertyDTO().validate(JSON.parse(event.body || '{}'));
            if (unit_uuid) {
                const unit = await this.propertyService.publishUnit(organisation.uuid, property_uuid, unit_uuid);
                return json(200, unit);
            }
            const property = await this.propertyService.publishProperty(organisation.uuid, property_uuid);
            return json(200, property);
        } catch (error) {
            if (error instanceof ValidationError) return json(400, { message: error.message, issues: error.issues });
            if (error instanceof PropertyNotFoundError || error instanceof UnitNotFoundError) return json(404, { message: (error as Error).message });
            if (error instanceof PropertyNotPublishedError || error instanceof ConcurrentModificationError) return json(409, { message: (error as Error).message });
            throw error;
        }
    }
}

export default PublishController;
