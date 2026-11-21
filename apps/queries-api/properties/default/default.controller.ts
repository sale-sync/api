import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods } from '@devyethiha/samjs';
import { getOrganisationFromBearerToken, NO_ORGANISATION } from '@sale-sync/shared';
import { OrganisationService } from '../services/organisation.service';
import { PropertyService } from '../services/property.service';
import type { PropertyType } from '@sale-sync/shared/src/types';

class DefaultController extends Controller implements IControllerMethods {
    private organisationService: OrganisationService;
    private propertyService: PropertyService;

    constructor(organisationService: OrganisationService, propertyService: PropertyService) {
        super('default');
        this.organisationService = organisationService;
        this.propertyService = propertyService;
    }

    // GET /properties?slug=<slug>                        → get one, by its slug
    // GET /properties?country={c}&city={ci}              → list by city within a country (TH-style location dropdown)
    // GET /properties?country={c}&region={r}&suburb={s}  → list by suburb within a region (AU-style location dropdown)
    // GET /properties?country={c}&region={r}             → list by region within a country
    // GET /properties?country={c}&postcode={p}           → list by postcode within a country (either market)
    // GET /properties?country={c}                        → list by country
    // GET /properties?type={t}                           → list by type (type-filter icon row)
    // GET /properties                                    → list all — property-map-view's initial, unfiltered load
    //
    // All query params are QUERY STRING PARAMETERS, not path segments — @devyethiha/samjs's
    // Controller/Router has no real support for path-segment routing (every pathMap entry it
    // registers has an undefined slug, so the router's own slug-matching never actually
    // distinguishes requests by path). This mirrors api/properties's own dispatch shape exactly,
    // one filter axis at a time — see that controller for the same pattern against real dashboard
    // data.
    //
    // Organisation comes from an `Authorization: Bearer <jwt>` header, same as branding — see
    // that controller's comment for why this is a header, not a cookie. Deliberately no
    // isAuthorize() call — genuinely public, unauthenticated route. Every result (single or list) is
    // filtered to scope: 'public' only — never 'staff'/'guest', regardless of any dashboard audience
    // rule (there is no authenticated viewer here at all — see PropertyService.parsePublicItems).
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        const organisation = getOrganisationFromBearerToken(event);
        if (!organisation?.uuid) return NO_ORGANISATION;
        const orgUuid = organisation.uuid;

        const org = await this.organisationService.getByUuid(orgUuid);
        if (!org) return { statusCode: 404, body: JSON.stringify({ message: 'Organisation not found' }) };

        const { slug, country, region, city, suburb, postcode, type } = event.queryStringParameters ?? {};

        if (slug) {
            const property = await this.propertyService.getPublicPropertyBySlug(orgUuid, slug);
            if (!property) return { statusCode: 404, body: JSON.stringify({ message: 'Property not found' }) };
            return { statusCode: 200, body: JSON.stringify(property) };
        }

        if (country && city) {
            const properties = await this.propertyService.listByCity(orgUuid, country, city);
            return { statusCode: 200, body: JSON.stringify(properties) };
        }

        if (country && region && suburb) {
            const properties = await this.propertyService.listBySuburb(orgUuid, country, region, suburb);
            return { statusCode: 200, body: JSON.stringify(properties) };
        }

        if (country && postcode) {
            const properties = await this.propertyService.listByPostcode(orgUuid, country, postcode);
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

        const properties = await this.propertyService.listPublicProperties(orgUuid);
        return { statusCode: 200, body: JSON.stringify(properties) };
    }
}

export default DefaultController;
