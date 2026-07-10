import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import type { Organisation, Property, PropertyType, Unit } from '@sale-sync/shared/src/types';
import type { CreatePropertyInput, UpdatePropertyInput } from '@sale-sync/shared/src/dtos';
import { v4 as uuidv4 } from 'uuid';

const TABLE = process.env.PROPERTY_TABLE_NAME || 'sale-sync-properties';
const ORGANISATION_TABLE = process.env.ORGANISATION_TABLE_NAME || 'sale-sync-organisation';

export class OrganisationNotFoundError extends Error {
    constructor(orgUuid: string) {
        super(`Organisation '${orgUuid}' not found`);
        this.name = 'OrganisationNotFoundError';
    }
}

export class PropertyNotFoundError extends Error {
    constructor(propertyUuid: string) {
        super(`Property '${propertyUuid}' not found`);
        this.name = 'PropertyNotFoundError';
    }
}

export class PropertyCategoryNotAllowedError extends Error {
    constructor(orgUuid: string) {
        super(`Organisation '${orgUuid}' is not a real-estate business and cannot manage properties`);
        this.name = 'PropertyCategoryNotAllowedError';
    }
}

// See docs/dynamodb/access-patterns/properties.md for the full key-schema rationale.
const pk = (orgUuid: string) => `ORG#${orgUuid}#PROPERTY`;
const sk = (propertyUuid: string) => `PROPERTY#${propertyUuid}`;
const gsi1pk = (orgUuid: string, country: string) => `ORG#${orgUuid}#PROPERTY#COUNTRY#${country}`;
const gsi1sk = (areaKey: string, propertyUuid: string) => `AREA#${areaKey}#PROPERTY#${propertyUuid}`;
const gsi2pk = (orgUuid: string, type: PropertyType) => `ORG#${orgUuid}#PROPERTY#TYPE#${type}`;
const gsi3pk = (orgUuid: string, country: string, region: string) => `ORG#${orgUuid}#PROPERTY#COUNTRY#${country}#REGION#${region}`;

export class PropertyService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('property');
        this.DB_Client = DB_Client;
    }

    // Create a property listing. Only orgs with business_category = "real-estate" may do this.
    public async createProperty(orgUuid: string, input: CreatePropertyInput): Promise<Property> {
        await this.assertRealEstateOrg(orgUuid);

        const now = new Date().toISOString();
        const property: Property = {
            uuid: uuidv4(),
            title: input.title,
            typeLabel: input.typeLabel,
            postedLabel: input.postedLabel,
            lat: input.lat,
            lng: input.lng,
            location: input.location,
            country: input.country,
            region: input.region ?? null,
            area_key: input.area_key,
            type: input.type,
            sellPrice: input.sellPrice ?? null,
            sellDiscountPrice: input.sellDiscountPrice ?? null,
            sellMaxPrice: input.sellMaxPrice ?? null,
            code: input.code ?? null,
            isLeasehold: input.isLeasehold ?? false,
            brochure: input.brochure ?? null,
            image: input.image ?? null,
            images: input.images ?? [],
            description: input.description ?? null,
            payment: input.payment ?? null,
            units: (input.units ?? []).map((unit) => this.normalizeUnit(unit)),
            created_at: now,
            updated_at: now,
        };

        await this.DB_Client.send(
            new PutCommand({
                TableName: TABLE,
                Item: {
                    PK: pk(orgUuid),
                    SK: sk(property.uuid),
                    ...this.gsiAttributes(orgUuid, property),
                    data: JSON.stringify(property),
                },
            }),
        );

        return property;
    }

    // Get a single property by ID
    public async getPropertyById(orgUuid: string, propertyUuid: string): Promise<Property | null> {
        const res = await this.DB_Client.send(
            new GetCommand({
                TableName: TABLE,
                Key: { PK: pk(orgUuid), SK: sk(propertyUuid) },
            }),
        );

        return res.Item ? (JSON.parse(res.Item.data as string) as Property) : null;
    }

    // List all properties for an org — used to export theme-maker's `data-properties` JSON at build time
    public async listProperties(orgUuid: string): Promise<Property[]> {
        const res = await this.DB_Client.send(
            new QueryCommand({
                TableName: TABLE,
                KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
                ExpressionAttributeValues: {
                    ':pk': pk(orgUuid),
                    ':prefix': 'PROPERTY#',
                },
            }),
        );

        return this.parseItems(res.Items);
    }

    // List properties in a country (e.g. an org's AU site vs. TH site at build time)
    public async listByCountry(orgUuid: string, country: string): Promise<Property[]> {
        const res = await this.DB_Client.send(
            new QueryCommand({
                TableName: TABLE,
                IndexName: 'property-area-index',
                KeyConditionExpression: 'GSI1PK = :pk',
                ExpressionAttributeValues: { ':pk': gsi1pk(orgUuid, country) },
            }),
        );

        return this.parseItems(res.Items);
    }

    // List properties in one area within a country — location dropdown filter
    public async listByArea(orgUuid: string, country: string, areaKey: string): Promise<Property[]> {
        const res = await this.DB_Client.send(
            new QueryCommand({
                TableName: TABLE,
                IndexName: 'property-area-index',
                KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
                ExpressionAttributeValues: {
                    ':pk': gsi1pk(orgUuid, country),
                    ':prefix': `AREA#${areaKey}#`,
                },
            }),
        );

        return this.parseItems(res.Items);
    }

    // List properties of a type — type-filter icon row
    public async listByType(orgUuid: string, type: PropertyType): Promise<Property[]> {
        const res = await this.DB_Client.send(
            new QueryCommand({
                TableName: TABLE,
                IndexName: 'property-type-index',
                KeyConditionExpression: 'GSI2PK = :pk',
                ExpressionAttributeValues: { ':pk': gsi2pk(orgUuid, type) },
            }),
        );

        return this.parseItems(res.Items);
    }

    // List properties in a state/province — sparse index; markets that leave `region` null
    // (e.g. Thailand) will never return results here, use listByCountry instead.
    public async listByRegion(orgUuid: string, country: string, region: string): Promise<Property[]> {
        const res = await this.DB_Client.send(
            new QueryCommand({
                TableName: TABLE,
                IndexName: 'property-region-index',
                KeyConditionExpression: 'GSI3PK = :pk',
                ExpressionAttributeValues: { ':pk': gsi3pk(orgUuid, country, region) },
            }),
        );

        return this.parseItems(res.Items);
    }

    // Update a property. Rewrites GSI1/GSI2/GSI3 attributes in place if their source fields change.
    public async updateProperty(orgUuid: string, propertyUuid: string, updates: Omit<UpdatePropertyInput, 'property_uuid'>): Promise<Property> {
        const existing = await this.getPropertyById(orgUuid, propertyUuid);
        if (!existing) throw new PropertyNotFoundError(propertyUuid);

        const updated: Property = {
            ...existing,
            ...(updates.title !== undefined && { title: updates.title }),
            ...(updates.typeLabel !== undefined && { typeLabel: updates.typeLabel }),
            ...(updates.postedLabel !== undefined && { postedLabel: updates.postedLabel }),
            ...(updates.lat !== undefined && { lat: updates.lat }),
            ...(updates.lng !== undefined && { lng: updates.lng }),
            ...(updates.location !== undefined && { location: updates.location }),
            ...(updates.country !== undefined && { country: updates.country }),
            ...(updates.region !== undefined && { region: updates.region }),
            ...(updates.area_key !== undefined && { area_key: updates.area_key }),
            ...(updates.type !== undefined && { type: updates.type }),
            ...(updates.sellPrice !== undefined && { sellPrice: updates.sellPrice }),
            ...(updates.sellDiscountPrice !== undefined && { sellDiscountPrice: updates.sellDiscountPrice }),
            ...(updates.sellMaxPrice !== undefined && { sellMaxPrice: updates.sellMaxPrice }),
            ...(updates.code !== undefined && { code: updates.code }),
            ...(updates.isLeasehold !== undefined && { isLeasehold: updates.isLeasehold }),
            ...(updates.brochure !== undefined && { brochure: updates.brochure }),
            ...(updates.image !== undefined && { image: updates.image }),
            ...(updates.images !== undefined && { images: updates.images }),
            ...(updates.description !== undefined && { description: updates.description }),
            ...(updates.payment !== undefined && { payment: updates.payment }),
            ...(updates.units !== undefined && { units: updates.units.map((unit) => this.normalizeUnit(unit)) }),
            updated_at: new Date().toISOString(),
        };

        const setClause = 'SET #data = :data, GSI1PK = :gsi1pk, GSI1SK = :gsi1sk, GSI2PK = :gsi2pk' + (updated.region ? ', GSI3PK = :gsi3pk, GSI3SK = :gsi3sk' : '');
        const removeClause = updated.region ? '' : ' REMOVE GSI3PK, GSI3SK';

        await this.DB_Client.send(
            new UpdateCommand({
                TableName: TABLE,
                Key: { PK: pk(orgUuid), SK: sk(propertyUuid) },
                UpdateExpression: setClause + removeClause,
                ExpressionAttributeNames: { '#data': 'data' },
                ExpressionAttributeValues: {
                    ':data': JSON.stringify(updated),
                    ':gsi1pk': gsi1pk(orgUuid, updated.country),
                    ':gsi1sk': gsi1sk(updated.area_key, propertyUuid),
                    ':gsi2pk': gsi2pk(orgUuid, updated.type),
                    ...(updated.region && { ':gsi3pk': gsi3pk(orgUuid, updated.country, updated.region) }),
                    ...(updated.region && { ':gsi3sk': gsi1sk(updated.area_key, propertyUuid) }),
                },
            }),
        );

        return updated;
    }

    // Delete a property
    public async deleteProperty(orgUuid: string, propertyUuid: string): Promise<void> {
        await this.DB_Client.send(
            new DeleteCommand({
                TableName: TABLE,
                Key: { PK: pk(orgUuid), SK: sk(propertyUuid) },
            }),
        );
    }

    private normalizeUnit(unit: Partial<Unit> & { title: string }): Unit {
        return {
            uuid: unit.uuid ?? uuidv4(),
            title: unit.title,
            image: unit.image ?? null,
            sellPrice: unit.sellPrice ?? null,
            sellDiscountPrice: unit.sellDiscountPrice ?? null,
            sellMaxPrice: unit.sellMaxPrice ?? null,
            beds: unit.beds ?? null,
            baths: unit.baths ?? null,
            hall: unit.hall ?? null,
            kitchen: unit.kitchen ?? null,
            pantry: unit.pantry ?? null,
            car: unit.car ?? null,
            unitSize: unit.unitSize ?? null,
            landSize: unit.landSize ?? null,
            size: unit.size ?? null,
            condition: unit.condition ?? null,
            furnishing: unit.furnishing ?? null,
        };
    }

    private gsiAttributes(orgUuid: string, property: Property): Record<string, string> {
        return {
            GSI1PK: gsi1pk(orgUuid, property.country),
            GSI1SK: gsi1sk(property.area_key, property.uuid),
            GSI2PK: gsi2pk(orgUuid, property.type),
            // Sparse: only written when region is set, matching markets (e.g. TH) that don't use it
            ...(property.region && {
                GSI3PK: gsi3pk(orgUuid, property.country, property.region),
                GSI3SK: gsi1sk(property.area_key, property.uuid),
            }),
        };
    }

    private parseItems(items: Record<string, unknown>[] | undefined): Property[] {
        return (items ?? []).map((item) => JSON.parse(item.data as string) as Property);
    }

    // Cross-table read: Property now lives in its own table, but the real-estate-category
    // gate still needs the org's metadata, which lives in the organisation service's table.
    private async assertRealEstateOrg(orgUuid: string): Promise<Organisation> {
        const res = await this.DB_Client.send(
            new GetCommand({
                TableName: ORGANISATION_TABLE,
                Key: { PK: 'ORG', SK: `META#${orgUuid}` },
            }),
        );

        if (!res.Item) throw new OrganisationNotFoundError(orgUuid);

        const org = JSON.parse(res.Item.data as string) as Organisation;
        if (org.business_category !== 'real-estate') throw new PropertyCategoryNotAllowedError(orgUuid);

        return org;
    }
}
