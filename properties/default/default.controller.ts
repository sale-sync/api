import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods, isAuthorize, UNAUTHORIZE_ERROR, ValidationError } from '@devyethiha/samjs';
import { getOrganisation, NO_ORGANISATION } from '@sale-sync/shared';
import { OrganisationNotFoundError, PropertyCategoryNotAllowedError, PropertyNotFoundError, PropertyService } from '../services/property.service';
import { CreatePropertyDTO } from '../dtos/create-property.dto';
import { UpdatePropertyDTO } from '../dtos/update-property.dto';
import { DeletePropertyDTO } from '../dtos/delete-property.dto';
import type { PropertyType } from '@sale-sync/shared/src/types';

class DefaultController extends Controller implements IControllerMethods {
    private propertyService: PropertyService;

    constructor(propertyService: PropertyService) {
        super('default');
        this.propertyService = propertyService;
    }

    // GET /properties?propertyUuid={uuid}   → get one
    // GET /properties?country={c}&areaKey={a} → list by area within a country
    // GET /properties?country={c}&region={r} → list by region within a country
    // GET /properties?country={c}           → list by country
    // GET /properties?type={t}              → list by type
    // GET /properties                       → list all (build-time export)
    //
    // Organisation context comes from the Organisation cookie JWT.
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        const organisation = getOrganisation(event);
        if (!organisation) return NO_ORGANISATION;
        const orgUuid = organisation.uuid;

        const { propertyUuid, country, region, areaKey, type } = event.queryStringParameters ?? {};

        if (propertyUuid) {
            const property = await this.propertyService.getPropertyById(orgUuid, propertyUuid);
            if (!property) return { statusCode: 404, body: JSON.stringify({ message: 'Property not found' }) };
            return { statusCode: 200, body: JSON.stringify(property) };
        }

        if (country && areaKey) {
            const properties = await this.propertyService.listByArea(orgUuid, country, areaKey);
            return { statusCode: 200, body: JSON.stringify(properties) };
        }

        if (country && region) {
            const properties = await this.propertyService.listByRegion(orgUuid, country, region);
            return { statusCode: 200, body: JSON.stringify(properties) };
        }

        if (country) {
            const properties = await this.propertyService.listByCountry(orgUuid, country);
            return { statusCode: 200, body: JSON.stringify(properties) };
        }

        if (type) {
            const properties = await this.propertyService.listByType(orgUuid, type as PropertyType);
            return { statusCode: 200, body: JSON.stringify(properties) };
        }

        const properties = await this.propertyService.listProperties(orgUuid);
        return { statusCode: 200, body: JSON.stringify(properties) };
    }

    // POST /properties → create a property listing
    // Organisation context comes from the Organisation cookie JWT.
    async post(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        const organisation = getOrganisation(event);
        if (!organisation) return NO_ORGANISATION;

        try {
            const input = new CreatePropertyDTO().validate(JSON.parse(event.body || '{}'));
            const property = await this.propertyService.createProperty(organisation.uuid, input);
            return { statusCode: 201, body: JSON.stringify(property) };
        } catch (error) {
            if (error instanceof ValidationError) {
                return { statusCode: 400, body: JSON.stringify({ message: error.message, issues: error.issues }) };
            }
            if (error instanceof OrganisationNotFoundError) {
                return { statusCode: 404, body: JSON.stringify({ message: (error as Error).message }) };
            }
            if (error instanceof PropertyCategoryNotAllowedError) {
                return { statusCode: 403, body: JSON.stringify({ message: (error as Error).message }) };
            }
            throw error;
        }
    }

    // PATCH /properties → update a property listing
    // Organisation context comes from the Organisation cookie JWT.
    async patch(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        const organisation = getOrganisation(event);
        if (!organisation) return NO_ORGANISATION;

        try {
            const { property_uuid, ...updates } = new UpdatePropertyDTO().validate(JSON.parse(event.body || '{}'));
            const property = await this.propertyService.updateProperty(organisation.uuid, property_uuid, updates);
            return { statusCode: 200, body: JSON.stringify(property) };
        } catch (error) {
            if (error instanceof ValidationError) {
                return { statusCode: 400, body: JSON.stringify({ message: error.message, issues: error.issues }) };
            }
            if (error instanceof PropertyNotFoundError) {
                return { statusCode: 404, body: JSON.stringify({ message: (error as Error).message }) };
            }
            throw error;
        }
    }

    // DELETE /properties → delete a property listing
    // Organisation context comes from the Organisation cookie JWT.
    async delete(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        const organisation = getOrganisation(event);
        if (!organisation) return NO_ORGANISATION;

        try {
            const body = new DeletePropertyDTO().validate(JSON.parse(event.body || '{}'));
            await this.propertyService.deleteProperty(organisation.uuid, body.property_uuid);
            return { statusCode: 200, body: JSON.stringify({ message: 'Property deleted' }) };
        } catch (error) {
            if (error instanceof ValidationError) {
                return { statusCode: 400, body: JSON.stringify({ message: error.message, issues: error.issues }) };
            }
            throw error;
        }
    }
}

export default DefaultController;
