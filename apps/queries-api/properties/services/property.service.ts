import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import type { Property, PropertyType } from '@sale-sync/shared/src/types';

const TABLE = process.env.PROPERTY_TABLE_NAME || 'sale-sync-properties';

// Same key scheme as api/properties/services/property.service.ts (see
// docs/dynamodb/access-patterns/properties.md) — this is a deliberately separate, minimal,
// read-only reimplementation, not a cross-lambda import (this stack is a different deployable,
// only @sale-sync/shared types/dtos are shared, matching branding/services/*'s existing precedent).
const pk = (orgUuid: string) => `ORG#${orgUuid}#PROPERTY`;
const sk = (propertyUuid: string) => `PROPERTY#${propertyUuid}`;
const slugPk = (orgUuid: string, slug: string) => `ORG#${orgUuid}#PROPERTY#SLUG#${slug}`;
const SLUG_SK = 'META';
const gsi1pk = (orgUuid: string, country: string) => `ORG#${orgUuid}#PROPERTY#COUNTRY#${country}`;
const gsi2pk = (orgUuid: string, type: PropertyType) => `ORG#${orgUuid}#PROPERTY#TYPE#${type}`;
const gsi3pk = (orgUuid: string, country: string, region: string) => `ORG#${orgUuid}#PROPERTY#COUNTRY#${country}#REGION#${region}`;
const gsi4pk = (orgUuid: string, country: string, postcode: string) => `ORG#${orgUuid}#PROPERTY#COUNTRY#${country}#POSTCODE#${postcode}`;

export class PropertyService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('property');
        this.DB_Client = DB_Client;
    }

    // Resolve a property by its (per-org-unique) slug, but only ever return it if
    // scope === 'public' — this is a genuinely public, unauthenticated route, so it does NOT reuse
    // api/properties's visibleScopesFor (that encodes dashboard-member audience rules — 'staff'/
    // 'guest' visibility for an authenticated team viewer — which don't apply to an anonymous
    // website visitor). Never distinguishes "not found" from "found but not public" in the response.
    public async getPublicPropertyBySlug(orgUuid: string, slug: string): Promise<Property | null> {
        const lookup = await this.DB_Client.send(
            new GetCommand({
                TableName: TABLE,
                Key: { PK: slugPk(orgUuid, slug), SK: SLUG_SK },
            }),
        );
        if (!lookup.Item) return null;

        const { property_uuid } = JSON.parse(lookup.Item.data as string) as { property_uuid: string };

        const res = await this.DB_Client.send(
            new GetCommand({
                TableName: TABLE,
                Key: { PK: pk(orgUuid), SK: sk(property_uuid) },
            }),
        );
        if (!res.Item) return null;

        const property = JSON.parse(res.Item.data as string) as Property;
        return property.scope === 'public' ? property : null;
    }

    // All of an org's public properties — the initial, unfiltered fetch property-map-view loads
    // before any filter is applied. Same "public only, no viewer role" rule as everything else here.
    public async listPublicProperties(orgUuid: string): Promise<Property[]> {
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

        return this.parsePublicItems(res.Items);
    }

    // Location-dropdown filter, country level.
    public async listByCountry(orgUuid: string, country: string): Promise<Property[]> {
        const res = await this.DB_Client.send(
            new QueryCommand({
                TableName: TABLE,
                IndexName: 'property-area-index',
                KeyConditionExpression: 'GSI1PK = :pk',
                ExpressionAttributeValues: { ':pk': gsi1pk(orgUuid, country) },
            }),
        );

        return this.parsePublicItems(res.Items);
    }

    // Location-dropdown filter, narrowed to one city (+ implicit neighborhood via prefix) — TH-style.
    public async listByCity(orgUuid: string, country: string, city: string): Promise<Property[]> {
        const res = await this.DB_Client.send(
            new QueryCommand({
                TableName: TABLE,
                IndexName: 'property-area-index',
                KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
                ExpressionAttributeValues: {
                    ':pk': gsi1pk(orgUuid, country),
                    ':prefix': `CITY#${city}#`,
                },
            }),
        );

        return this.parsePublicItems(res.Items);
    }

    // Location-dropdown filter, narrowed to one suburb within a region — AU-style.
    public async listBySuburb(orgUuid: string, country: string, region: string, suburb: string): Promise<Property[]> {
        const res = await this.DB_Client.send(
            new QueryCommand({
                TableName: TABLE,
                IndexName: 'property-region-index',
                KeyConditionExpression: 'GSI3PK = :pk AND begins_with(GSI3SK, :prefix)',
                ExpressionAttributeValues: {
                    ':pk': gsi3pk(orgUuid, country, region),
                    ':prefix': `SUBURB#${suburb}#`,
                },
            }),
        );

        return this.parsePublicItems(res.Items);
    }

    // Postcode filter — standalone axis, either market.
    public async listByPostcode(orgUuid: string, country: string, postcode: string): Promise<Property[]> {
        const res = await this.DB_Client.send(
            new QueryCommand({
                TableName: TABLE,
                IndexName: 'property-postcode-index',
                KeyConditionExpression: 'GSI4PK = :pk',
                ExpressionAttributeValues: { ':pk': gsi4pk(orgUuid, country, postcode) },
            }),
        );

        return this.parsePublicItems(res.Items);
    }

    // Type-filter icon row.
    public async listByType(orgUuid: string, type: PropertyType): Promise<Property[]> {
        const res = await this.DB_Client.send(
            new QueryCommand({
                TableName: TABLE,
                IndexName: 'property-type-index',
                KeyConditionExpression: 'GSI2PK = :pk',
                ExpressionAttributeValues: { ':pk': gsi2pk(orgUuid, type) },
            }),
        );

        return this.parsePublicItems(res.Items);
    }

    // State/province filter — sparse index, markets that leave `region` null (e.g. Thailand) never
    // appear here; use listByCountry instead.
    public async listByRegion(orgUuid: string, country: string, region: string): Promise<Property[]> {
        const res = await this.DB_Client.send(
            new QueryCommand({
                TableName: TABLE,
                IndexName: 'property-region-index',
                KeyConditionExpression: 'GSI3PK = :pk',
                ExpressionAttributeValues: { ':pk': gsi3pk(orgUuid, country, region) },
            }),
        );

        return this.parsePublicItems(res.Items);
    }

    // Parse + drop anything that isn't scope: 'public' — every list method funnels through this, so
    // the "public only" rule lives in exactly one place.
    private parsePublicItems(items: Record<string, unknown>[] | undefined): Property[] {
        return (items ?? [])
            .map((item) => JSON.parse(item.data as string) as Property)
            .filter((property) => property.scope === 'public');
    }
}
