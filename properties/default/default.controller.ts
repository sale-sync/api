import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods, isAuthorize, UNAUTHORIZE_ERROR, ValidationError } from '@devyethiha/samjs';
import { getOrganisation, NO_ORGANISATION } from '@sale-sync/shared';
import { OrganisationNotFoundError, PropertyCategoryNotAllowedError, PropertyNotFoundError, SlugAlreadyExistsError, PropertyService } from '../services/property.service';
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
    // GET /properties?slug={slug}           → get one, by its slug (unique per org)
    // GET /properties?country={c}&areaKey={a} → list by area within a country
    // GET /properties?country={c}&region={r} → list by region within a country
    // GET /properties?country={c}           → list by country
    // GET /properties?type={t}              → list by type
    // GET /properties                       → list all
    //
    // Organisation context comes from the Organisation cookie JWT. Every result is filtered by the
    // caller's org role (content-scope-visibility) — see PropertyService.getViewerRole/visibleScopesFor.
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        const organisation = getOrganisation(event);
        if (!organisation) return NO_ORGANISATION;
        const orgUuid = organisation.uuid;
        const viewerRole = await this.propertyService.getViewerRole(orgUuid, organisation.user_id);

        const { propertyUuid, slug, country, region, areaKey, type } = event.queryStringParameters ?? {};

        if (propertyUuid) {
            const property = await this.propertyService.getPropertyById(orgUuid, propertyUuid, viewerRole);
            if (!property) return { statusCode: 404, body: JSON.stringify({ message: 'Property not found' }) };
            return { statusCode: 200, body: JSON.stringify(property) };
        }

        if (slug) {
            const property = await this.propertyService.getPropertyBySlug(orgUuid, slug, viewerRole);
            if (!property) return { statusCode: 404, body: JSON.stringify({ message: 'Property not found' }) };
            return { statusCode: 200, body: JSON.stringify(property) };
        }

        if (country && areaKey) {
            const properties = await this.propertyService.listByArea(orgUuid, country, areaKey, viewerRole);
            return { statusCode: 200, body: JSON.stringify(properties) };
        }

        if (country && region) {
            const properties = await this.propertyService.listByRegion(orgUuid, country, region, viewerRole);
            return { statusCode: 200, body: JSON.stringify(properties) };
        }

        if (country) {
            const properties = await this.propertyService.listByCountry(orgUuid, country, viewerRole);
            return { statusCode: 200, body: JSON.stringify(properties) };
        }

        if (type) {
            const properties = await this.propertyService.listByType(orgUuid, type as PropertyType, viewerRole);
            return { statusCode: 200, body: JSON.stringify(properties) };
        }

        const properties = await this.propertyService.listProperties(orgUuid, viewerRole);
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
            if (error instanceof SlugAlreadyExistsError) {
                return { statusCode: 409, body: JSON.stringify({ message: (error as Error).message }) };
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
            if (error instanceof SlugAlreadyExistsError) {
                return { statusCode: 409, body: JSON.stringify({ message: (error as Error).message }) };
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
