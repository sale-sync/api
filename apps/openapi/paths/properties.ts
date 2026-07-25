import { z } from 'zod';
import { CreatePropertySchema, UpdatePropertySchema, DeletePropertySchema } from '@sale-sync/shared';

const security: Array<Record<string, string[]>> = [{ authenticationCookie: [], identifierCookie: [], organisationAuth: [] }];

const PropertyTypeSchema = z.enum(['house', 'condo', 'commercial', 'land']);

const UnitSchema = z.object({
    uuid: z.string().uuid(),
    title: z.string(),
    image: z.string().nullable(),
    actions: z.array(z.enum(['sell', 'rent', 'sold'])),
    sellPrice: z.number().nullable(),
    sellDiscountPrice: z.number().nullable(),
    sellMaxPrice: z.number().nullable(),
    soldPrice: z.number().nullable(),
    rentPrice: z.number().nullable(),
    beds: z.number().nullable(),
    baths: z.number().nullable(),
    hall: z.number().nullable(),
    kitchen: z.number().nullable(),
    pantry: z.number().nullable(),
    car: z.number().nullable(),
    unitSize: z.number().nullable(),
    landSize: z.number().nullable(),
    condition: z.string().nullable(),
    furnishing: z.string().nullable(),
    ownership: z.enum(['Freehold', 'Leasehold']).nullable(),
});

const PropertySchema = z.object({
    uuid: z.string().uuid(),
    title: z.string(),
    lat: z.number(),
    lng: z.number(),
    location: z.string(),
    country: z.string().meta({ description: 'ISO 3166-1 alpha-2, e.g. "TH", "AU" — open, not a fixed enum' }),
    region: z.string().nullable().meta({ description: 'State/province, e.g. "NSW". null for markets that don\'t search by it (e.g. Thailand)' }),
    city: z.string().nullable().meta({ description: 'TH-style markets: required. null for AU-style markets.' }),
    neighborhood: z.string().nullable().meta({ description: 'TH-style markets: optional. null for AU-style markets.' }),
    suburb: z.string().nullable().meta({ description: 'AU-style markets: required. null for TH-style markets.' }),
    postcode: z.string().nullable().meta({ description: 'Populated for either market — required for AU, optional for TH (shipping/documentation).' }),
    type: PropertyTypeSchema,
    subType: z.string().nullable().meta({ description: 'Free text sub-classification within `type` (e.g. "High Rise" for condo, "Attached House" for house, "Shop House" for commercial) — default suggestions only, not a fixed enum. Always null for type "land".' }),
    sellPrice: z.number().nullable(),
    sellDiscountPrice: z.number().nullable(),
    sellMaxPrice: z.number().nullable(),
    code: z.string().nullable(),
    isLeasehold: z.boolean(),
    brochure: z.string().nullable(),
    image: z.string().nullable(),
    images: z.array(z.string()),
    description: z.string().nullable(),
    payment: z.string().nullable(),
    units: z.array(UnitSchema),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
});

const errorSchema = z.object({ message: z.string() });
const validationErrorSchema = z.object({ message: z.string(), issues: z.array(z.unknown()) });

export const propertiesPaths = {
    '/properties': {
        get: {
            tags: ['Property'],
            summary: 'Get, or list, property listings',
            description: [
                'Always scoped to one organisation, resolved from the `Organisation` cookie JWT. The remaining query parameters are mutually exclusive and select the access pattern:',
                '',
                '- `propertyUuid` — get a single property by ID',
                '- `country` + `city` — list properties in one city (TH-style location dropdown filter); matches by prefix, so any neighborhood within that city is included',
                '- `country` + `region` + `suburb` — list properties in one suburb within a region (AU-style location dropdown filter)',
                '- `country` + `region` — list properties in one state/province within a country (sparse — only returns results for markets that populate `region`, e.g. Australia)',
                '- `country` + `postcode` — list properties in one postcode within a country (sparse — either market, required for AU / optional for TH)',
                '- `country` only — list all properties in a country (e.g. an org\'s AU site vs. TH site)',
                '- `type` only — list properties of a type (type-filter icon row)',
                '- none of the above — list every property for the org (used to export theme-maker\'s `data-properties` JSON at build time)',
            ].join('\n'),
            security,
            requestParams: {
                query: z.object({
                    propertyUuid: z.string().uuid().optional().meta({ description: 'Property UUID — returns a single property' }),
                    country: z.string().optional().meta({ description: 'ISO 3166-1 alpha-2 country code, e.g. "TH", "AU"' }),
                    region: z.string().optional().meta({ description: 'State/province, e.g. "NSW" — combine with country' }),
                    city: z.string().optional().meta({ description: 'TH-style city slug — combine with country' }),
                    suburb: z.string().optional().meta({ description: 'AU-style suburb slug — combine with country and region' }),
                    postcode: z.string().optional().meta({ description: 'Postcode — combine with country' }),
                    type: PropertyTypeSchema.optional().meta({ description: 'Property type filter' }),
                }),
            },
            responses: {
                '200': {
                    description: 'A single property (when `propertyUuid` is given) or an array of properties',
                    content: {
                        'application/json': { schema: z.union([PropertySchema, z.array(PropertySchema)]) },
                    },
                },
                '401': { description: 'Unauthorized' },
                '403': { description: 'No organisation context' },
                '404': {
                    description: 'Property not found (when propertyUuid was given)',
                    content: { 'application/json': { schema: errorSchema } },
                },
            },
        },
        post: {
            tags: ['Property'],
            summary: 'Create a property listing',
            description: 'Only organisations with `business_category = "real-estate"` may create properties — checked via a cross-table read against the organisation metadata table before the write.',
            security,
            requestBody: {
                required: true,
                content: { 'application/json': { schema: CreatePropertySchema } },
            },
            responses: {
                '201': {
                    description: 'Property created',
                    content: { 'application/json': { schema: PropertySchema } },
                },
                '400': {
                    description: 'Validation error',
                    content: { 'application/json': { schema: validationErrorSchema } },
                },
                '401': { description: 'Unauthorized' },
                '403': {
                    description: 'No organisation context, or organisation is not a real-estate business',
                    content: { 'application/json': { schema: errorSchema } },
                },
                '404': {
                    description: 'Organisation not found',
                    content: { 'application/json': { schema: errorSchema } },
                },
            },
        },
        patch: {
            tags: ['Property'],
            summary: 'Update a property listing',
            description: 'Only provided fields are updated. If `country`, `region`, `city`, `neighborhood`, `suburb`, `postcode`, or `type` change, the underlying GSI attributes are rewritten (or removed, for `region`/`postcode` going to `null`) in the same write.',
            security,
            requestBody: {
                required: true,
                content: { 'application/json': { schema: UpdatePropertySchema } },
            },
            responses: {
                '200': {
                    description: 'Updated property',
                    content: { 'application/json': { schema: PropertySchema } },
                },
                '400': {
                    description: 'Validation error',
                    content: { 'application/json': { schema: validationErrorSchema } },
                },
                '401': { description: 'Unauthorized' },
                '403': { description: 'No organisation context' },
                '404': {
                    description: 'Property not found',
                    content: { 'application/json': { schema: errorSchema } },
                },
            },
        },
        delete: {
            tags: ['Property'],
            summary: 'Delete a property listing',
            security,
            requestBody: {
                required: true,
                content: { 'application/json': { schema: DeletePropertySchema } },
            },
            responses: {
                '200': {
                    description: 'Property deleted',
                    content: { 'application/json': { schema: z.object({ message: z.string() }) } },
                },
                '400': {
                    description: 'Validation error',
                    content: { 'application/json': { schema: validationErrorSchema } },
                },
                '401': { description: 'Unauthorized' },
                '403': { description: 'No organisation context' },
            },
        },
    },
};
