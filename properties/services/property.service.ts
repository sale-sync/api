import { DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import { MARKET_CURRENCY } from '@sale-sync/shared/src/types';
import type { Organisation, OrganisationRole, OrganisationUser, Property, PropertyCurrency, PropertyScope, PropertyType, Unit } from '@sale-sync/shared/src/types';
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

export class SlugAlreadyExistsError extends Error {
    constructor(slug: string) {
        super(`A property with slug '${slug}' already exists for this organisation`);
        this.name = 'SlugAlreadyExistsError';
    }
}

// See docs/dynamodb/access-patterns/properties.md for the full key-schema rationale.
const pk = (orgUuid: string) => `ORG#${orgUuid}#PROPERTY`;
const sk = (propertyUuid: string) => `PROPERTY#${propertyUuid}`;
const gsi1pk = (orgUuid: string, country: string) => `ORG#${orgUuid}#PROPERTY#COUNTRY#${country}`;
const gsi1sk = (areaKey: string, propertyUuid: string) => `AREA#${areaKey}#PROPERTY#${propertyUuid}`;
const gsi2pk = (orgUuid: string, type: PropertyType) => `ORG#${orgUuid}#PROPERTY#TYPE#${type}`;
const gsi3pk = (orgUuid: string, country: string, region: string) => `ORG#${orgUuid}#PROPERTY#COUNTRY#${country}#REGION#${region}`;
// Slug uniqueness/lookup is scoped per-organisation (not global, unlike Organisation.id's
// PK=ORG#ID#{id}) — two different orgs' public sites are unrelated, nothing requires their
// property slugs not to collide with each other.
const slugPk = (orgUuid: string, slug: string) => `ORG#${orgUuid}#PROPERTY#SLUG#${slug}`;
const SLUG_SK = 'META';

function isConditionalCheckFailure(error: unknown): boolean {
    return error instanceof TransactionCanceledException && (error.CancellationReasons ?? []).some((r) => r.Code === 'ConditionalCheckFailed');
}

export class PropertyService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('property');
        this.DB_Client = DB_Client;
    }

    // Create a property listing. Only orgs with business_category = "real-estate" may do this.
    public async createProperty(orgUuid: string, input: CreatePropertyInput): Promise<Property> {
        const org = await this.assertRealEstateOrg(orgUuid);

        const country = input.country ?? org.market;
        const currency = input.currency ?? MARKET_CURRENCY[org.market];

        const now = new Date().toISOString();
        const property: Property = {
            uuid: uuidv4(),
            title: input.title,
            lat: input.lat,
            lng: input.lng,
            location: input.location,
            country,
            currency,
            region: input.region ?? null,
            area_key: input.area_key,
            type: input.type,
            scope: input.scope,
            slug: input.slug,
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
            units: (input.units ?? []).map((unit) => this.normalizeUnit(unit, currency)),
            created_at: now,
            updated_at: now,
        };

        try {
            await this.DB_Client.send(
                new TransactWriteCommand({
                    TransactItems: [
                        {
                            Put: {
                                TableName: TABLE,
                                Item: {
                                    PK: pk(orgUuid),
                                    SK: sk(property.uuid),
                                    ...this.gsiAttributes(orgUuid, property),
                                    data: JSON.stringify(property),
                                },
                            },
                        },
                        // Slug uniqueness / slug→uuid lookup — PK=ORG#{orgUuid}#PROPERTY#SLUG#{slug}, SK=META
                        {
                            Put: {
                                TableName: TABLE,
                                Item: {
                                    PK: slugPk(orgUuid, input.slug),
                                    SK: SLUG_SK,
                                    data: JSON.stringify({ property_uuid: property.uuid }),
                                },
                                ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
                            },
                        },
                    ],
                }),
            );
        } catch (error) {
            if (isConditionalCheckFailure(error)) throw new SlugAlreadyExistsError(input.slug);
            throw error;
        }

        return property;
    }

    // Get a single property by ID, scoped to what viewerRole is allowed to see (per
    // content-scope-visibility) — returns null (not the item) if the property exists but its
    // scope isn't visible to this viewer, same as a genuinely-missing item.
    public async getPropertyById(orgUuid: string, propertyUuid: string, viewerRole: OrganisationRole | null): Promise<Property | null> {
        const property = await this.getPropertyRecord(orgUuid, propertyUuid);
        if (!property) return null;
        return this.visibleScopesFor(viewerRole).includes(property.scope) ? property : null;
    }

    // Resolve a property by its slug (unique per org), then apply the same viewer-scoped visibility
    // as getPropertyById. Returns null if the slug doesn't resolve to anything.
    public async getPropertyBySlug(orgUuid: string, slug: string, viewerRole: OrganisationRole | null): Promise<Property | null> {
        const res = await this.DB_Client.send(
            new GetCommand({
                TableName: TABLE,
                Key: { PK: slugPk(orgUuid, slug), SK: SLUG_SK },
            }),
        );
        if (!res.Item) return null;

        const { property_uuid } = JSON.parse(res.Item.data as string) as { property_uuid: string };
        return this.getPropertyById(orgUuid, property_uuid, viewerRole);
    }

    // List all properties for an org, filtered to what viewerRole can see.
    public async listProperties(orgUuid: string, viewerRole: OrganisationRole | null): Promise<Property[]> {
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

        return this.filterByScope(this.parseItems(res.Items), viewerRole);
    }

    // List properties in a country (e.g. an org's AU site vs. TH site), filtered by viewerRole.
    public async listByCountry(orgUuid: string, country: string, viewerRole: OrganisationRole | null): Promise<Property[]> {
        const res = await this.DB_Client.send(
            new QueryCommand({
                TableName: TABLE,
                IndexName: 'property-area-index',
                KeyConditionExpression: 'GSI1PK = :pk',
                ExpressionAttributeValues: { ':pk': gsi1pk(orgUuid, country) },
            }),
        );

        return this.filterByScope(this.parseItems(res.Items), viewerRole);
    }

    // List properties in one area within a country — location dropdown filter, by viewerRole.
    public async listByArea(orgUuid: string, country: string, areaKey: string, viewerRole: OrganisationRole | null): Promise<Property[]> {
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

        return this.filterByScope(this.parseItems(res.Items), viewerRole);
    }

    // List properties of a type — type-filter icon row, by viewerRole.
    public async listByType(orgUuid: string, type: PropertyType, viewerRole: OrganisationRole | null): Promise<Property[]> {
        const res = await this.DB_Client.send(
            new QueryCommand({
                TableName: TABLE,
                IndexName: 'property-type-index',
                KeyConditionExpression: 'GSI2PK = :pk',
                ExpressionAttributeValues: { ':pk': gsi2pk(orgUuid, type) },
            }),
        );

        return this.filterByScope(this.parseItems(res.Items), viewerRole);
    }

    // List properties in a state/province — sparse index; markets that leave `region` null
    // (e.g. Thailand) will never return results here, use listByCountry instead. Filtered by viewerRole.
    public async listByRegion(orgUuid: string, country: string, region: string, viewerRole: OrganisationRole | null): Promise<Property[]> {
        const res = await this.DB_Client.send(
            new QueryCommand({
                TableName: TABLE,
                IndexName: 'property-region-index',
                KeyConditionExpression: 'GSI3PK = :pk',
                ExpressionAttributeValues: { ':pk': gsi3pk(orgUuid, country, region) },
            }),
        );

        return this.filterByScope(this.parseItems(res.Items), viewerRole);
    }

    // Update a property. Rewrites GSI1/GSI2/GSI3 attributes in place if their source fields change.
    public async updateProperty(orgUuid: string, propertyUuid: string, updates: Omit<UpdatePropertyInput, 'property_uuid'>): Promise<Property> {
        const existing = await this.getPropertyRecord(orgUuid, propertyUuid);
        if (!existing) throw new PropertyNotFoundError(propertyUuid);

        const currency = updates.currency !== undefined ? updates.currency : existing.currency;

        const updated: Property = {
            ...existing,
            ...(updates.title !== undefined && { title: updates.title }),
            ...(updates.lat !== undefined && { lat: updates.lat }),
            ...(updates.lng !== undefined && { lng: updates.lng }),
            ...(updates.location !== undefined && { location: updates.location }),
            ...(updates.country !== undefined && { country: updates.country }),
            ...(updates.currency !== undefined && { currency: updates.currency }),
            ...(updates.region !== undefined && { region: updates.region }),
            ...(updates.area_key !== undefined && { area_key: updates.area_key }),
            ...(updates.type !== undefined && { type: updates.type }),
            ...(updates.scope !== undefined && { scope: updates.scope }),
            ...(updates.slug !== undefined && { slug: updates.slug }),
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
            // Units are re-normalized whenever the payload includes units OR the currency changed —
            // the latter case cascades the new currency onto every existing unit, even ones not
            // present in this update's payload.
            ...(updates.units !== undefined
                ? { units: updates.units.map((unit) => this.normalizeUnit(unit, currency)) }
                : updates.currency !== undefined
                  ? { units: existing.units.map((unit) => this.normalizeUnit(unit, currency)) }
                  : {}),
            updated_at: new Date().toISOString(),
        };

        const setClause = 'SET #data = :data, GSI1PK = :gsi1pk, GSI1SK = :gsi1sk, GSI2PK = :gsi2pk' + (updated.region ? ', GSI3PK = :gsi3pk, GSI3SK = :gsi3sk' : '');
        const removeClause = updated.region ? '' : ' REMOVE GSI3PK, GSI3SK';

        // slug is a separate item (for uniqueness), not just an attribute — always run this as a
        // transaction so the main item and the slug lookup never drift out of sync, even though most
        // updates don't touch slug at all.
        const slugChanged = updates.slug !== undefined && updates.slug !== existing.slug;

        try {
            await this.DB_Client.send(
                new TransactWriteCommand({
                    TransactItems: [
                        {
                            Update: {
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
                            },
                        },
                        ...(slugChanged && existing.slug
                            ? [{ Delete: { TableName: TABLE, Key: { PK: slugPk(orgUuid, existing.slug), SK: SLUG_SK } } }]
                            : []),
                        ...(slugChanged
                            ? [
                                  {
                                      Put: {
                                          TableName: TABLE,
                                          Item: {
                                              PK: slugPk(orgUuid, updates.slug as string),
                                              SK: SLUG_SK,
                                              data: JSON.stringify({ property_uuid: propertyUuid }),
                                          },
                                          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
                                      },
                                  },
                              ]
                            : []),
                    ],
                }),
            );
        } catch (error) {
            if (isConditionalCheckFailure(error)) throw new SlugAlreadyExistsError(updates.slug as string);
            throw error;
        }

        return updated;
    }

    // Delete a property. Also removes its slug lookup item, if it had one, so nothing dangles.
    public async deleteProperty(orgUuid: string, propertyUuid: string): Promise<void> {
        const existing = await this.getPropertyRecord(orgUuid, propertyUuid);
        if (!existing) return;

        await this.DB_Client.send(
            new TransactWriteCommand({
                TransactItems: [
                    { Delete: { TableName: TABLE, Key: { PK: pk(orgUuid), SK: sk(propertyUuid) } } },
                    ...(existing.slug ? [{ Delete: { TableName: TABLE, Key: { PK: slugPk(orgUuid, existing.slug), SK: SLUG_SK } } } as const] : []),
                ],
            }),
        );
    }

    // currency is always set from the property-level value, ignoring any per-unit currency the
    // client sends — a property has one currency, cascaded to every unit.
    private normalizeUnit(unit: Partial<Unit> & { title: string }, currency: PropertyCurrency): Unit {
        return {
            uuid: unit.uuid ?? uuidv4(),
            title: unit.title,
            image: unit.image ?? null,
            tag: unit.tag ?? 'buy',
            sellPrice: unit.sellPrice ?? null,
            sellDiscountPrice: unit.sellDiscountPrice ?? null,
            sellMaxPrice: unit.sellMaxPrice ?? null,
            soldPrice: unit.soldPrice ?? null,
            rentPrice: unit.rentPrice ?? null,
            beds: unit.beds ?? null,
            baths: unit.baths ?? null,
            hall: unit.hall ?? null,
            kitchen: unit.kitchen ?? null,
            pantry: unit.pantry ?? null,
            car: unit.car ?? null,
            unitSize: unit.unitSize ?? null,
            landSize: unit.landSize ?? null,
            condition: unit.condition ?? null,
            furnishing: unit.furnishing ?? null,
            currency,
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

    // Existing records written before `scope`/`slug` existed have neither attribute — default
    // scope to 'staff' (internal-only) rather than a bulk migration, so nothing unexpectedly leaks
    // public; slug simply stays null (not publicly linkable until edited to add one).
    private parseItem(data: string): Property {
        const property = JSON.parse(data) as Property;
        return { ...property, scope: property.scope ?? 'staff', slug: property.slug ?? null };
    }

    private parseItems(items: Record<string, unknown>[] | undefined): Property[] {
        return (items ?? []).map((item) => this.parseItem(item.data as string));
    }

    // Unfiltered single-item read, for internal use only (e.g. updateProperty's existence check) —
    // never expose this directly to a controller; use getPropertyById (viewer-scoped) for that.
    private async getPropertyRecord(orgUuid: string, propertyUuid: string): Promise<Property | null> {
        const res = await this.DB_Client.send(
            new GetCommand({
                TableName: TABLE,
                Key: { PK: pk(orgUuid), SK: sk(propertyUuid) },
            }),
        );

        return res.Item ? this.parseItem(res.Item.data as string) : null;
    }

    // Audience rule (content-scope-visibility): 'guest'-role viewers see public+guest scope only;
    // everyone else sees public+staff+guest. A null role (cookie references a user with no
    // membership row — shouldn't normally happen) is treated as the most restrictive case, not
    // full access.
    private visibleScopesFor(viewerRole: OrganisationRole | null): PropertyScope[] {
        return viewerRole === 'guest' || viewerRole === null ? ['public', 'guest'] : ['public', 'staff', 'guest'];
    }

    private filterByScope(properties: Property[], viewerRole: OrganisationRole | null): Property[] {
        const visible = this.visibleScopesFor(viewerRole);
        return properties.filter((property) => visible.includes(property.scope));
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

    // Deliberately duplicated (not cross-lambda imported) from
    // api/media/services/organisation-membership.service.ts's pattern — reads the viewer's
    // membership role directly from ORGANISATION_TABLE rather than trusting the (unverified,
    // jwt-decode-only) Organisation cookie JWT, which carries no role at all.
    public async getViewerRole(orgUuid: string, userId: string): Promise<OrganisationRole | null> {
        const res = await this.DB_Client.send(
            new GetCommand({
                TableName: ORGANISATION_TABLE,
                Key: { PK: `ORG#${orgUuid}`, SK: `USER#${userId}` },
            }),
        );

        if (!res.Item) return null;
        const membership = JSON.parse(res.Item.data as string) as OrganisationUser;
        return membership.role;
    }
}
