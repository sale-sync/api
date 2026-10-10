import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods, isAuthorize, UNAUTHORIZE_ERROR, ValidationError } from '@devyethiha/samjs';
import { getOrganisation, NO_ORGANISATION } from '@sale-sync/shared';
import { ConcurrentModificationError, PropertyNotFoundError, PropertyService, UnitNotFoundError } from '../services/property.service';
import { CreateUnitDTO } from '../dtos/create-unit.dto';
import { UpdateUnitDTO } from '../dtos/update-unit.dto';
import { DeleteUnitDTO } from '../dtos/delete-unit.dto';

const json = (statusCode: number, body: unknown): APIGatewayProxyResult => ({ statusCode, body: JSON.stringify(body) });

// A unit is its own sub-resource of a property: created, saved (as a draft), deleted and published
// on its own, instead of riding along inside PATCH /properties' payload. Organisation context comes
// from the Organisation cookie JWT, same as the default controller.
class UnitsController extends Controller implements IControllerMethods {
    private propertyService: PropertyService;

    constructor(propertyService: PropertyService) {
        super('units');
        this.propertyService = propertyService;
    }

    // GET /properties/units?propertyUuid={uuid}&unitUuid={uuid} → get one unit (draft, with publishStatus)
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        const organisation = getOrganisation(event);
        if (!organisation) return NO_ORGANISATION;

        const { propertyUuid, unitUuid } = event.queryStringParameters ?? {};
        if (!propertyUuid || !unitUuid) return json(400, { message: 'Missing query params: propertyUuid, unitUuid' });

        const viewerRole = await this.propertyService.getViewerRole(organisation.uuid, organisation.user_id);
        const unit = await this.propertyService.getUnit(organisation.uuid, propertyUuid, unitUuid, viewerRole);
        if (!unit) return json(404, { message: 'Unit not found' });
        return json(200, unit);
    }

    // POST /properties/units → create a unit under a property (saved as an unpublished draft)
    async post(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        const organisation = getOrganisation(event);
        if (!organisation) return NO_ORGANISATION;

        try {
            const input = new CreateUnitDTO().validate(JSON.parse(event.body || '{}'));
            const unit = await this.propertyService.createUnit(organisation.uuid, input);
            return json(201, unit);
        } catch (error) {
            return this.errorResponse(error);
        }
    }

    // PATCH /properties/units → update a unit's draft
    async patch(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        const organisation = getOrganisation(event);
        if (!organisation) return NO_ORGANISATION;

        try {
            const input = new UpdateUnitDTO().validate(JSON.parse(event.body || '{}'));
            const unit = await this.propertyService.updateUnit(organisation.uuid, input);
            return json(200, unit);
        } catch (error) {
            return this.errorResponse(error);
        }
    }

    // DELETE /properties/units → delete a unit (also removes it from the published copy)
    async delete(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        const organisation = getOrganisation(event);
        if (!organisation) return NO_ORGANISATION;

        try {
            const body = new DeleteUnitDTO().validate(JSON.parse(event.body || '{}'));
            await this.propertyService.deleteUnit(organisation.uuid, body.property_uuid, body.unit_uuid);
            return json(200, { message: 'Unit deleted' });
        } catch (error) {
            return this.errorResponse(error);
        }
    }

    private errorResponse(error: unknown): APIGatewayProxyResult {
        if (error instanceof ValidationError) return json(400, { message: error.message, issues: error.issues });
        if (error instanceof PropertyNotFoundError || error instanceof UnitNotFoundError) return json(404, { message: (error as Error).message });
        if (error instanceof ConcurrentModificationError) return json(409, { message: error.message });
        throw error;
    }
}

export default UnitsController;
