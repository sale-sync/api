import { ConditionalCheckFailedException, DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { Service } from '@devyethiha/samjs';
import { MARKET_CURRENCY } from '@sale-sync/shared/src/types';
import type { Organisation, OrganisationRole, OrganisationUser, Property, PropertyCurrency, PropertyScope, PropertyType, PropertyPublishStatus, Unit } from '@sale-sync/shared/src/types';
import { normalizeStoredProperty, normalizeUnitFees } from '@sale-sync/shared/src/utils/property';
import type { CreatePropertyInput, CreateUnitInput, UpdatePropertyInput, UpdateUnitInput } from '@sale-sync/shared/src/dtos';
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

export class UnitNotFoundError extends Error {
    constructor(unitUuid: string) {
        super(`Unit '${unitUuid}' not found`);
        this.name = 'UnitNotFoundError';
    }
}

// The draft changed between this request reading it and writing it (another tab, another user, or a
// unit save racing a property save) — the caller should reload and retry rather than overwrite.
export class ConcurrentModificationError extends Error {
    constructor() {
        super('This property was changed by someone else while you were saving. Reload and try again.');
        this.name = 'ConcurrentModificationError';
    }
}

export class PropertyNotPublishedError extends Error {
    constructor(propertyUuid: string) {
        super(`Property '${propertyUuid}' must be published before its units can be published`);
        this.name = 'PropertyNotPublishedError';
    }
}

// Same fire-and-forget cross-stack invoke idiom the organisation app's services use — the two
// generator Lambdas (publish-property-detail-page / publish-property-unit-detail-page) live in
// ss/infra, a different SAM stack. Unlike the table names, these are deliberately allowed to be
// unset: until a generator is deployed the publish itself must still succeed, it just bakes nothing.
const PUBLISH_PROPERTY_DETAIL_PAGE_FUNCTION_NAME = process.env.PUBLISH_PROPERTY_DETAIL_PAGE_FUNCTION_NAME;
const PUBLISH_PROPERTY_UNIT_DETAIL_PAGE_FUNCTION_NAME = process.env.PUBLISH_PROPERTY_UNIT_DETAIL_PAGE_FUNCTION_NAME;
const lambdaClient = new LambdaClient({});

async function invokeGenerator(functionName: string | undefined, label: string, payload: Record<string, unknown>): Promise<void> {
    if (!functionName) {
        console.warn(`${label} function name is not configured — skipping page generation`);
        return;
    }
    try {
        await lambdaClient.send(new InvokeCommand({ FunctionName: functionName, InvocationType: 'Event', Payload: JSON.stringify(payload) }));
    } catch (error) {
        // The publish itself already succeeded — a failed bake must not turn it into an error.
        console.error(`Failed to invoke ${label} — published, but page generation was not started`, error);
    }
}

// Key-order-independent JSON, so two copies of the same unit/property compare equal regardless of
// how their objects were built.
function stableStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value && typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        return `{${Object.keys(obj)
            .sort()
            .filter((key) => obj[key] !== undefined)
            .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
}

// Property fields that don't count as a publishable edit: units publish on their own, the rest are
// bookkeeping.
function propertyContent(property: Property): string {
    const { units: _units, created_at: _c, updated_at: _u, publishStatus: _s, published_at: _p, ...content } = property;
    return stableStringify(content);
}

function unitContent(unit: Unit): string {
    const { publishStatus: _s, ...content } = unit;
    return stableStringify(content);
}

// See docs/api/dynamodb/access-patterns/properties.md for the full key-schema rationale.
const pk = (orgUuid: string) => `ORG#${orgUuid}#PROPERTY`;
const sk = (propertyUuid: string) => `PROPERTY#${propertyUuid}`;
// GSI1 stays country-only (not region-inclusive) — it's what serves listByCountry, which needs a
// single partition key spanning every region within a country (impossible if region were folded
// in, since DynamoDB Query only targets one partition key value). TH never populates region, so
// GSI1SK (city/neighborhood) is TH's primary browse-by-location index; AU browses via GSI3 instead
// (region already disambiguates AU's — and any future market's — same-named suburbs/cities).
const gsi1pk = (orgUuid: string, country: string) => `ORG#${orgUuid}#PROPERTY#COUNTRY#${country}`;
const gsi1sk = (city: string | null, neighborhood: string | null, propertyUuid: string) =>
    `CITY#${city ?? ''}#NEIGHBORHOOD#${neighborhood ?? ''}#PROPERTY#${propertyUuid}`;
const gsi2pk = (orgUuid: string, type: PropertyType) => `ORG#${orgUuid}#PROPERTY#TYPE#${type}`;
const gsi3pk = (orgUuid: string, country: string, region: string) => `ORG#${orgUuid}#PROPERTY#COUNTRY#${country}#REGION#${region}`;
const gsi3sk = (suburb: string | null, propertyUuid: string) => `SUBURB#${suburb ?? ''}#PROPERTY#${propertyUuid}`;
// postcode is filtered standalone (not nested under city/suburb), so it needs its own index rather
// than a suffix on GSI1SK/GSI3SK — see docs/api/dynamodb/access-patterns/properties.md. Sparse,
// written for either market whenever postcode is set (not AU-only).
const gsi4pk = (orgUuid: string, country: string, postcode: string) => `ORG#${orgUuid}#PROPERTY#COUNTRY#${country}#POSTCODE#${postcode}`;
const gsi4sk = (propertyUuid: string) => `PROPERTY#${propertyUuid}`;
// Slug uniqueness/lookup is scoped per-organisation (not global, unlike Organisation.id's
// PK=ORG#ID#{id}) — two different orgs' public sites are unrelated, nothing requires their
// property slugs not to collide with each other.
const slugPk = (orgUuid: string, slug: string) => `ORG#${orgUuid}#PROPERTY#SLUG#${slug}`;
const SLUG_SK = 'META';

// The first TransactItem in updateProperty is always the main item's Update, so a failed condition
// there (CancellationReasons[0]) means the optimistic lock, not the slug-uniqueness Put.
function isMainItemConditionFailure(error: unknown): boolean {
    return error instanceof TransactionCanceledException && error.CancellationReasons?.[0]?.Code === 'ConditionalCheckFailed';
}

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
            city: input.city ?? null,
            neighborhood: input.neighborhood ?? null,
            suburb: input.suburb ?? null,
            postcode: input.postcode ?? null,
            type: input.type,
            subType: input.subType ?? null,
            scope: input.scope,
            slug: input.slug,
            sellPrice: input.sellPrice ?? null,
            sellDiscountPrice: input.sellDiscountPrice ?? null,
            sellMaxPrice: input.sellMaxPrice ?? null,
            code: input.code ?? null,
            isLeasehold: input.isLeasehold ?? false,
            swimmingPool: input.swimmingPool ?? false,
            completion: input.completion ?? null,
            completionDate: input.completionDate ?? null,
            totalFloor: input.totalFloor ?? null,
            petFriendly: input.petFriendly ?? 'No Pets',
            commonAreaFees: input.commonAreaFees ?? null,
            sinkingFund: input.sinkingFund ?? null,
            videos: input.videos ?? [],
            brochure: input.brochure ?? null,
            image: input.image ?? null,
            images: input.images ?? [],
            description: input.description ?? null,
            payment: input.payment ?? null,
            units: [],
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

        return { ...property, publishStatus: 'unpublished', published_at: null };
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

    // List properties in one city (+ optional neighborhood) within a country — TH-style location
    // dropdown filter, by viewerRole.
    public async listByCity(orgUuid: string, country: string, city: string, viewerRole: OrganisationRole | null): Promise<Property[]> {
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

        return this.filterByScope(this.parseItems(res.Items), viewerRole);
    }

    // List properties in one suburb within a region — AU-style location dropdown filter, by
    // viewerRole. Region already disambiguates same-named suburbs across states.
    public async listBySuburb(orgUuid: string, country: string, region: string, suburb: string, viewerRole: OrganisationRole | null): Promise<Property[]> {
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

        return this.filterByScope(this.parseItems(res.Items), viewerRole);
    }

    // List properties by postcode — standalone filter axis (not nested under city/suburb/region),
    // by viewerRole. Sparse index; properties without a postcode never appear here.
    public async listByPostcode(orgUuid: string, country: string, postcode: string, viewerRole: OrganisationRole | null): Promise<Property[]> {
        const res = await this.DB_Client.send(
            new QueryCommand({
                TableName: TABLE,
                IndexName: 'property-postcode-index',
                KeyConditionExpression: 'GSI4PK = :pk',
                ExpressionAttributeValues: { ':pk': gsi4pk(orgUuid, country, postcode) },
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
        const raw = await this.getRawItem(orgUuid, propertyUuid);
        if (!raw) throw new PropertyNotFoundError(propertyUuid);
        const existing = this.parseStored(raw.data as string);

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
            ...(updates.city !== undefined && { city: updates.city }),
            ...(updates.neighborhood !== undefined && { neighborhood: updates.neighborhood }),
            ...(updates.suburb !== undefined && { suburb: updates.suburb }),
            ...(updates.postcode !== undefined && { postcode: updates.postcode }),
            ...(updates.type !== undefined && { type: updates.type }),
            ...(updates.subType !== undefined && { subType: updates.subType }),
            ...(updates.scope !== undefined && { scope: updates.scope }),
            ...(updates.slug !== undefined && { slug: updates.slug }),
            ...(updates.sellPrice !== undefined && { sellPrice: updates.sellPrice }),
            ...(updates.sellDiscountPrice !== undefined && { sellDiscountPrice: updates.sellDiscountPrice }),
            ...(updates.sellMaxPrice !== undefined && { sellMaxPrice: updates.sellMaxPrice }),
            ...(updates.code !== undefined && { code: updates.code }),
            ...(updates.isLeasehold !== undefined && { isLeasehold: updates.isLeasehold }),
            ...(updates.swimmingPool !== undefined && { swimmingPool: updates.swimmingPool }),
            ...(updates.completion !== undefined && { completion: updates.completion }),
            ...(updates.completionDate !== undefined && { completionDate: updates.completionDate }),
            ...(updates.totalFloor !== undefined && { totalFloor: updates.totalFloor }),
            ...(updates.petFriendly !== undefined && { petFriendly: updates.petFriendly }),
            ...(updates.commonAreaFees !== undefined && { commonAreaFees: updates.commonAreaFees }),
            ...(updates.sinkingFund !== undefined && { sinkingFund: updates.sinkingFund }),
            ...(updates.videos !== undefined && { videos: updates.videos }),
            ...(updates.brochure !== undefined && { brochure: updates.brochure }),
            ...(updates.image !== undefined && { image: updates.image }),
            ...(updates.images !== undefined && { images: updates.images }),
            ...(updates.description !== undefined && { description: updates.description }),
            ...(updates.payment !== undefined && { payment: updates.payment }),
            updated_at: new Date().toISOString(),
        };

        // Units aren't part of this payload any more (they have their own endpoints) but are still
        // re-normalized on every property update, because a changed currency or fee rate cascades onto
        // every existing unit (non-overridden fees are unitSize x Property rate).
        updated.units = existing.units.map((unit) => this.normalizeUnit(unit, currency, updated));

        // GSI3 (region) and GSI4 (postcode) are both sparse — SET when their source field is
        // populated, REMOVE (not just cleared) when it isn't, same pattern GSI3 already used before
        // GSI4 existed. DynamoDB only allows one SET and one REMOVE clause per UpdateExpression, so
        // both attribute pairs' presence/absence is collected into shared arrays first.
        const setParts = ['#data = :data', 'GSI1PK = :gsi1pk', 'GSI1SK = :gsi1sk', 'GSI2PK = :gsi2pk'];
        const removeParts: string[] = [];
        const gsiValues: Record<string, string> = {
            ':gsi1pk': gsi1pk(orgUuid, updated.country),
            ':gsi1sk': gsi1sk(updated.city, updated.neighborhood, propertyUuid),
            ':gsi2pk': gsi2pk(orgUuid, updated.type),
        };
        if (updated.region) {
            setParts.push('GSI3PK = :gsi3pk', 'GSI3SK = :gsi3sk');
            gsiValues[':gsi3pk'] = gsi3pk(orgUuid, updated.country, updated.region);
            gsiValues[':gsi3sk'] = gsi3sk(updated.suburb, propertyUuid);
        } else {
            removeParts.push('GSI3PK', 'GSI3SK');
        }
        if (updated.postcode) {
            setParts.push('GSI4PK = :gsi4pk', 'GSI4SK = :gsi4sk');
            gsiValues[':gsi4pk'] = gsi4pk(orgUuid, updated.country, updated.postcode);
            gsiValues[':gsi4sk'] = gsi4sk(propertyUuid);
        } else {
            removeParts.push('GSI4PK', 'GSI4SK');
        }
        const updateExpression = `SET ${setParts.join(', ')}` + (removeParts.length ? ` REMOVE ${removeParts.join(', ')}` : '');

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
                                UpdateExpression: updateExpression,
                                // Optimistic lock: refuse to overwrite a draft that changed since it was read
                                // (e.g. a unit saved from another tab in the meantime).
                                ConditionExpression: '#data = :prevData',
                                ExpressionAttributeNames: { '#data': 'data' },
                                ExpressionAttributeValues: {
                                    ':data': JSON.stringify(updated),
                                    ':prevData': raw.data as string,
                                    ...gsiValues,
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
            if (isMainItemConditionFailure(error)) throw new ConcurrentModificationError();
            if (isConditionalCheckFailure(error)) throw new SlugAlreadyExistsError(updates.slug as string);
            throw error;
        }

        return this.annotate(updated, raw.published ? this.parseStored(raw.published as string) : null, (raw.published_at as string | undefined) ?? null);
    }

    // Delete a property. Also removes its slug lookup item, if it had one, so nothing dangles.
    public async deleteProperty(orgUuid: string, propertyUuid: string): Promise<void> {
        const raw = await this.getRawItem(orgUuid, propertyUuid);
        if (!raw) return;
        const existing = this.parseStored(raw.data as string);
        const published = raw.published ? this.parseStored(raw.published as string) : null;

        await this.DB_Client.send(
            new TransactWriteCommand({
                TransactItems: [
                    { Delete: { TableName: TABLE, Key: { PK: pk(orgUuid), SK: sk(propertyUuid) } } },
                    ...(existing.slug ? [{ Delete: { TableName: TABLE, Key: { PK: slugPk(orgUuid, existing.slug), SK: SLUG_SK } } } as const] : []),
                ],
            }),
        );

        // Remove whatever was baked: the property's page and every published unit's page. Nothing was
        // baked if it was never published.
        if (published?.slug) {
            await invokeGenerator(PUBLISH_PROPERTY_DETAIL_PAGE_FUNCTION_NAME, 'publish-property-detail-page', {
                organisation_uuid: orgUuid,
                property_uuid: propertyUuid,
                removed_slugs: [published.slug],
            });
            await invokeGenerator(PUBLISH_PROPERTY_UNIT_DETAIL_PAGE_FUNCTION_NAME, 'publish-property-unit-detail-page', {
                organisation_uuid: orgUuid,
                property_uuid: propertyUuid,
                removed: published.units.map((unit) => ({ property_slug: published.slug, unit_uuid: unit.uuid })),
            });
        }
    }

    // ── Units ───────────────────────────────────────────────
    // Units stay embedded on the property item (docs/api/dynamodb/access-patterns/properties.md: they
    // are only ever read with their parent, and the public read path wants them in one point read), but
    // each one is created/edited/deleted/published through its own call. Every write below is a
    // read-modify-write guarded by the same optimistic lock as updateProperty, so two saves racing can't
    // silently drop each other's unit.

    public async createUnit(orgUuid: string, input: CreateUnitInput): Promise<Unit> {
        const { property_uuid, ...fields } = input;
        const { raw, draft } = await this.loadDraft(orgUuid, property_uuid);

        const unit = this.normalizeUnit(fields, draft.currency, draft);
        await this.writeDraft(raw, { ...draft, units: [...draft.units, unit], updated_at: new Date().toISOString() });
        return { ...unit, publishStatus: 'unpublished' };
    }

    public async getUnit(orgUuid: string, propertyUuid: string, unitUuid: string, viewerRole: OrganisationRole | null): Promise<Unit | null> {
        const property = await this.getPropertyById(orgUuid, propertyUuid, viewerRole);
        return property?.units.find((unit) => unit.uuid === unitUuid) ?? null;
    }

    public async updateUnit(orgUuid: string, input: UpdateUnitInput): Promise<Unit> {
        const { property_uuid, unit_uuid, ...updates } = input;
        const { raw, draft, published } = await this.loadDraft(orgUuid, property_uuid);

        const existing = draft.units.find((unit) => unit.uuid === unit_uuid);
        if (!existing) throw new UnitNotFoundError(unit_uuid);

        const definedUpdates = Object.fromEntries(Object.entries(updates).filter(([, value]) => value !== undefined));
        const updated = this.normalizeUnit({ ...existing, ...definedUpdates, uuid: unit_uuid } as Partial<Unit> & { title: string }, draft.currency, draft);
        await this.writeDraft(raw, {
            ...draft,
            units: draft.units.map((unit) => (unit.uuid === unit_uuid ? updated : unit)),
            updated_at: new Date().toISOString(),
        });

        const live = published?.units.find((unit) => unit.uuid === unit_uuid);
        return { ...updated, publishStatus: !live ? 'unpublished' : unitContent(live) === unitContent(updated) ? 'published' : 'changed' };
    }

    // Deleting is immediate on the public side too: a deleted unit is removed from the published
    // snapshot in the same write (there is nothing to "unpublish" afterwards), and its baked page is
    // removed.
    public async deleteUnit(orgUuid: string, propertyUuid: string, unitUuid: string): Promise<void> {
        const { raw, draft, published } = await this.loadDraft(orgUuid, propertyUuid);
        if (!draft.units.some((unit) => unit.uuid === unitUuid)) return;

        const wasPublished = !!published?.units.some((unit) => unit.uuid === unitUuid);
        await this.writeDraft(
            raw,
            { ...draft, units: draft.units.filter((unit) => unit.uuid !== unitUuid), updated_at: new Date().toISOString() },
            wasPublished && published ? { ...published, units: published.units.filter((unit) => unit.uuid !== unitUuid) } : undefined,
        );

        if (wasPublished && published?.slug) {
            await invokeGenerator(PUBLISH_PROPERTY_UNIT_DETAIL_PAGE_FUNCTION_NAME, 'publish-property-unit-detail-page', {
                organisation_uuid: orgUuid,
                property_uuid: propertyUuid,
                removed: [{ property_slug: published.slug, unit_uuid: unitUuid }],
            });
        }
    }

    // ── Publishing ──────────────────────────────────────────

    // Copies the draft's property fields onto the published snapshot. Published units are left exactly
    // as they are — each unit publishes on its own.
    public async publishProperty(orgUuid: string, propertyUuid: string): Promise<Property> {
        const { raw, draft, published } = await this.loadDraft(orgUuid, propertyUuid);

        const next: Property = { ...draft, units: published?.units ?? [] };
        const publishedAt = new Date().toISOString();
        await this.writePublished(raw, next, publishedAt);

        // Unit pages live under the property's slug (/properties/<slug>/units/<id>) and only exist for a
        // public property, so a slug change or a scope change (public <-> staff/guest) re-bakes, or
        // removes, every published unit's page. The generator turns "bake" into "delete" for a
        // property that is no longer public, so the payload is the same either way.
        const previousSlug = published?.slug ?? null;
        const slugChanged = !!previousSlug && previousSlug !== next.slug;
        const scopeChanged = !!published && (published.scope === 'public') !== (next.scope === 'public');
        await invokeGenerator(PUBLISH_PROPERTY_DETAIL_PAGE_FUNCTION_NAME, 'publish-property-detail-page', {
            organisation_uuid: orgUuid,
            property_uuid: propertyUuid,
            slug: next.slug,
            removed_slugs: slugChanged ? [previousSlug] : [],
        });
        if ((slugChanged || scopeChanged) && next.units.length > 0) {
            await invokeGenerator(PUBLISH_PROPERTY_UNIT_DETAIL_PAGE_FUNCTION_NAME, 'publish-property-unit-detail-page', {
                organisation_uuid: orgUuid,
                property_uuid: propertyUuid,
                property_slug: next.slug,
                unit_uuids: next.units.map((unit) => unit.uuid),
                removed: slugChanged ? next.units.map((unit) => ({ property_slug: previousSlug, unit_uuid: unit.uuid })) : [],
            });
        }

        return this.annotate(draft, next, publishedAt);
    }

    // Copies one unit from the draft onto the published snapshot. Requires the property itself to be
    // published first — an unpublished property has no public page for the unit to hang off.
    public async publishUnit(orgUuid: string, propertyUuid: string, unitUuid: string): Promise<Unit> {
        const { raw, draft, published } = await this.loadDraft(orgUuid, propertyUuid);
        if (!published) throw new PropertyNotPublishedError(propertyUuid);

        const unit = draft.units.find((candidate) => candidate.uuid === unitUuid);
        if (!unit) throw new UnitNotFoundError(unitUuid);

        const units = published.units.some((candidate) => candidate.uuid === unitUuid)
            ? published.units.map((candidate) => (candidate.uuid === unitUuid ? unit : candidate))
            : [...published.units, unit];
        await this.writePublished(raw, { ...published, units }, (raw.published_at as string | undefined) ?? new Date().toISOString());

        await invokeGenerator(PUBLISH_PROPERTY_UNIT_DETAIL_PAGE_FUNCTION_NAME, 'publish-property-unit-detail-page', {
            organisation_uuid: orgUuid,
            property_uuid: propertyUuid,
            property_slug: published.slug,
            unit_uuids: [unitUuid],
            removed: [],
        });

        return { ...unit, publishStatus: 'published' };
    }

    private async loadDraft(orgUuid: string, propertyUuid: string): Promise<{ raw: Record<string, unknown>; draft: Property; published: Property | null }> {
        const raw = await this.getRawItem(orgUuid, propertyUuid);
        if (!raw) throw new PropertyNotFoundError(propertyUuid);
        return {
            raw,
            draft: this.parseStored(raw.data as string),
            published: raw.published ? this.parseStored(raw.published as string) : null,
        };
    }

    // Writes a new draft (and optionally a new published snapshot in the same update), only if the
    // stored draft is still exactly what was read.
    private async writeDraft(raw: Record<string, unknown>, draft: Property, published?: Property): Promise<void> {
        try {
            await this.DB_Client.send(
                new UpdateCommand({
                    TableName: TABLE,
                    Key: { PK: raw.PK as string, SK: raw.SK as string },
                    UpdateExpression: published ? 'SET #data = :data, published = :published' : 'SET #data = :data',
                    ConditionExpression: '#data = :prevData',
                    ExpressionAttributeNames: { '#data': 'data' },
                    ExpressionAttributeValues: {
                        ':data': JSON.stringify(draft),
                        ':prevData': raw.data as string,
                        ...(published && { ':published': JSON.stringify(published) }),
                    },
                }),
            );
        } catch (error) {
            if (error instanceof ConditionalCheckFailedException) throw new ConcurrentModificationError();
            throw error;
        }
    }

    // Writes the published snapshot only if the draft is still what was read, so publishing never
    // goes live with something other than what the user last saw.
    private async writePublished(raw: Record<string, unknown>, published: Property, publishedAt: string): Promise<void> {
        try {
            await this.DB_Client.send(
                new UpdateCommand({
                    TableName: TABLE,
                    Key: { PK: raw.PK as string, SK: raw.SK as string },
                    UpdateExpression: 'SET published = :published, published_at = :publishedAt',
                    ConditionExpression: '#data = :prevData',
                    ExpressionAttributeNames: { '#data': 'data' },
                    ExpressionAttributeValues: {
                        ':published': JSON.stringify(published),
                        ':publishedAt': publishedAt,
                        ':prevData': raw.data as string,
                    },
                }),
            );
        } catch (error) {
            if (error instanceof ConditionalCheckFailedException) throw new ConcurrentModificationError();
            throw error;
        }
    }

    // currency is always set from the property-level value, ignoring any per-unit currency the
    // client sends — a property has one currency, cascaded to every unit.
    private normalizeUnit(unit: Partial<Unit> & { title: string }, currency: PropertyCurrency, property: Pick<Property, 'commonAreaFees' | 'sinkingFund'>): Unit {
        return {
            uuid: unit.uuid ?? uuidv4(),
            title: unit.title,
            image: unit.image ?? null,
            actions: unit.actions?.length ? unit.actions : ['sell'],
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
            ownership: unit.ownership ?? null,
            petFriendly: unit.petFriendly ?? null,
            multipurposeRoom: unit.multipurposeRoom ?? null,
            poolVilla: unit.poolVilla ?? false,
            livingRoom: unit.livingRoom ?? null,
            ...normalizeUnitFees(unit, property),
            videos: unit.videos ?? [],
            bookingFees: unit.bookingFees ?? null,
            contractFees: unit.contractFees ?? null,
            contractFeesTimeline: unit.contractFeesTimeline ?? null,
            paymentOptions: unit.paymentOptions?.length ? unit.paymentOptions : ['Complete'],
            finalPayment: unit.finalPayment ?? null,
            finalPaymentTimeline: unit.finalPaymentTimeline ?? null,
            installmentPayment: unit.installmentPayment ?? null,
            installmentPaymentTimeline: unit.installmentPaymentTimeline ?? null,
            currency,
        };
    }

    private gsiAttributes(orgUuid: string, property: Property): Record<string, string> {
        return {
            GSI1PK: gsi1pk(orgUuid, property.country),
            GSI1SK: gsi1sk(property.city, property.neighborhood, property.uuid),
            GSI2PK: gsi2pk(orgUuid, property.type),
            // Sparse: only written when region is set, matching markets (e.g. TH) that don't use it
            ...(property.region && {
                GSI3PK: gsi3pk(orgUuid, property.country, property.region),
                GSI3SK: gsi3sk(property.suburb, property.uuid),
            }),
            // Sparse: written for either market whenever postcode is set (not AU-only)
            ...(property.postcode && {
                GSI4PK: gsi4pk(orgUuid, property.country, property.postcode),
                GSI4SK: gsi4sk(property.uuid),
            }),
        };
    }

    // Existing records written before `scope`/`slug` existed have neither attribute — default
    // scope to 'staff' (internal-only) rather than a bulk migration, so nothing unexpectedly leaks
    // public; slug simply stays null (not publicly linkable until edited to add one).
    private parseStored(data: string): Property {
        const property = JSON.parse(data) as Property;
        return normalizeStoredProperty({ ...property, scope: property.scope ?? 'staff', slug: property.slug ?? null });
    }

    // A stored item holds two copies: `data` is the draft (what the dashboard edits and what every
    // GSI is derived from) and `published` is the last-published snapshot (what the public website
    // reads, via queries-api). Dashboard reads return the draft, annotated with each entity's
    // publish state so the UI can show "unpublished" / "changed" without a second request.
    private parseItem(item: Record<string, unknown>): Property {
        const draft = this.parseStored(item.data as string);
        const published = item.published ? this.parseStored(item.published as string) : null;
        return this.annotate(draft, published, (item.published_at as string | undefined) ?? null);
    }

    private annotate(draft: Property, published: Property | null, publishedAt: string | null): Property {
        const publishedUnits = new Map((published?.units ?? []).map((unit) => [unit.uuid, unit]));
        const status = (isPublished: boolean, same: boolean): PropertyPublishStatus => (!isPublished ? 'unpublished' : same ? 'published' : 'changed');
        return {
            ...draft,
            publishStatus: status(!!published, !!published && propertyContent(published) === propertyContent(draft)),
            published_at: publishedAt,
            units: draft.units.map((unit) => {
                const live = publishedUnits.get(unit.uuid);
                return { ...unit, publishStatus: status(!!live, !!live && unitContent(live) === unitContent(unit)) };
            }),
        };
    }

    private parseItems(items: Record<string, unknown>[] | undefined): Property[] {
        return (items ?? []).map((item) => this.parseItem(item));
    }

    // Unfiltered single-item read, for internal use only (e.g. updateProperty's existence check) —
    // never expose this directly to a controller; use getPropertyById (viewer-scoped) for that.
    private async getPropertyRecord(orgUuid: string, propertyUuid: string): Promise<Property | null> {
        const raw = await this.getRawItem(orgUuid, propertyUuid);
        return raw ? this.parseItem(raw) : null;
    }

    private async getRawItem(orgUuid: string, propertyUuid: string): Promise<Record<string, unknown> | null> {
        const res = await this.DB_Client.send(
            new GetCommand({
                TableName: TABLE,
                Key: { PK: pk(orgUuid), SK: sk(propertyUuid) },
            }),
        );

        return (res.Item as Record<string, unknown> | undefined) ?? null;
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
