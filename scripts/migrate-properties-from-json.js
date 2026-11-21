#!/usr/bin/env node
// One-off bulk import for backlogs/client-data-migration/children/properties-migration-wix-to-json:
// reads a JSON array of property records (converted from a client's exported Wix CSV — see that
// backlog's tasks.md) and creates each one in sale-sync-properties.
//
// Writes directly to DynamoDB rather than calling POST /properties, because that endpoint's auth
// isn't practical to script for a one-off bulk job: it needs a real Cognito Hosted-UI OAuth login
// (Authentication/Identifier cookies) plus a separate "switch organisation" call that mints the
// Organisation cookie by signing a JWT with ORGANISATION_SECRET (platform/apps/web-app/src/routes/
// api/organisation/set.ts) — not something to script, and that secret shouldn't be touched here.
//
// To stay behaviorally identical to what PropertyService.createProperty() would produce, this
// script:
//   - validates each record with the real CreatePropertySchema from @sale-sync/shared (the same
//     Zod schema apps/api/properties/dtos/create-property.dto.ts wraps for the API), so a record
//     that would be rejected by the real endpoint is rejected here too;
//   - duplicates the exact key-derivation functions (pk/sk/gsi1-4/slugPk) and the normalizeUnit /
//     gsiAttributes logic from api/apps/api/properties/services/property.service.ts (see
//     docs/api/dynamodb/access-patterns/properties.md for the key-schema rationale) — kept in sync
//     by copying, not importing, since that file is TypeScript and this is a plain-node script;
//   - re-checks the target org exists and is business_category = 'real-estate' (assertRealEstateOrg
//     in property.service.ts does the same check on every create).
//
// Slug uniqueness is checked per-record before writing (GetCommand on the slug-lookup item) and
// enforced again by the same ConditionExpression the real service uses, so re-running this script
// after a partial run only creates the records that don't already exist yet.
//
// SAFETY: dry-run by default — only prints what would be created/skipped. Pass --execute to write.
// Always run against staging first.
//
// Usage:
//   AWS_PROFILE=<profile> AWS_REGION=<region> node scripts/migrate-properties-from-json.js \
//     --org-uuid <organisation-uuid> --file <path/to/properties.json> [--execute] \
//     [--table <name>] [--org-table <name>]
//
// Input file shape: a JSON array of objects matching CreatePropertySchema, e.g.:
//   [{ "title": "...", "lat": 13.7, "lng": 100.5, "location": "...", "type": "condo",
//      "slug": "some-condo", "units": [{ "title": "Unit 1" }], ... }, ...]

const { DynamoDBClient, TransactionCanceledException } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const { CreatePropertySchema, MARKET_CURRENCY } = require('@sale-sync/shared');

const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');

function flagValue(name, fallback) {
    const i = args.indexOf(name);
    return i !== -1 ? args[i + 1] : fallback;
}

const ORG_UUID = flagValue('--org-uuid', null);
const FILE = flagValue('--file', null);
const TABLE = flagValue('--table', process.env.PROPERTY_TABLE_NAME || 'sale-sync-properties');
const ORGANISATION_TABLE = flagValue('--org-table', process.env.ORGANISATION_TABLE_NAME || 'sale-sync-organisation');

if (!ORG_UUID || !FILE) {
    console.error('Usage: node scripts/migrate-properties-from-json.js --org-uuid <uuid> --file <path/to/properties.json> [--execute]');
    process.exit(1);
}

const client = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(client);

// Duplicated verbatim from api/apps/api/properties/services/property.service.ts — see that file
// and docs/api/dynamodb/access-patterns/properties.md before changing either copy.
const pk = (orgUuid) => `ORG#${orgUuid}#PROPERTY`;
const sk = (propertyUuid) => `PROPERTY#${propertyUuid}`;
const gsi1pk = (orgUuid, country) => `ORG#${orgUuid}#PROPERTY#COUNTRY#${country}`;
const gsi1sk = (city, neighborhood, propertyUuid) => `CITY#${city ?? ''}#NEIGHBORHOOD#${neighborhood ?? ''}#PROPERTY#${propertyUuid}`;
const gsi2pk = (orgUuid, type) => `ORG#${orgUuid}#PROPERTY#TYPE#${type}`;
const gsi3pk = (orgUuid, country, region) => `ORG#${orgUuid}#PROPERTY#COUNTRY#${country}#REGION#${region}`;
const gsi3sk = (suburb, propertyUuid) => `SUBURB#${suburb ?? ''}#PROPERTY#${propertyUuid}`;
const gsi4pk = (orgUuid, country, postcode) => `ORG#${orgUuid}#PROPERTY#COUNTRY#${country}#POSTCODE#${postcode}`;
const gsi4sk = (propertyUuid) => `PROPERTY#${propertyUuid}`;
const slugPk = (orgUuid, slug) => `ORG#${orgUuid}#PROPERTY#SLUG#${slug}`;
const SLUG_SK = 'META';

function normalizeUnit(unit, currency) {
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
        currency,
    };
}

function gsiAttributes(orgUuid, property) {
    return {
        GSI1PK: gsi1pk(orgUuid, property.country),
        GSI1SK: gsi1sk(property.city, property.neighborhood, property.uuid),
        GSI2PK: gsi2pk(orgUuid, property.type),
        ...(property.region && {
            GSI3PK: gsi3pk(orgUuid, property.country, property.region),
            GSI3SK: gsi3sk(property.suburb, property.uuid),
        }),
        ...(property.postcode && {
            GSI4PK: gsi4pk(orgUuid, property.country, property.postcode),
            GSI4SK: gsi4sk(property.uuid),
        }),
    };
}

function isConditionalCheckFailure(error) {
    return error instanceof TransactionCanceledException && (error.CancellationReasons ?? []).some((r) => r.Code === 'ConditionalCheckFailed');
}

async function loadOrganisation(orgUuid) {
    const res = await doc.send(new GetCommand({ TableName: ORGANISATION_TABLE, Key: { PK: 'ORG', SK: `META#${orgUuid}` } }));
    if (!res.Item) throw new Error(`Organisation '${orgUuid}' not found in ${ORGANISATION_TABLE}`);
    const org = JSON.parse(res.Item.data);
    if (org.business_category !== 'real-estate') {
        throw new Error(`Organisation '${orgUuid}' is not a real-estate business (business_category=${org.business_category}) — cannot create properties`);
    }
    return org;
}

async function slugExists(orgUuid, slug) {
    const res = await doc.send(new GetCommand({ TableName: TABLE, Key: { PK: slugPk(orgUuid, slug), SK: SLUG_SK } }));
    return !!res.Item;
}

async function main() {
    console.log(`[migrate-properties-from-json] org=${ORG_UUID} table=${TABLE} org-table=${ORGANISATION_TABLE} file=${FILE} mode=${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}`);

    const org = await loadOrganisation(ORG_UUID);

    const raw = fs.readFileSync(FILE, 'utf8');
    const records = JSON.parse(raw);
    if (!Array.isArray(records)) {
        throw new Error(`${FILE} must contain a JSON array of property records`);
    }

    let validationFailed = 0;
    let alreadyExists = 0;
    let created = 0;
    let writeErrors = 0;

    for (let i = 0; i < records.length; i++) {
        const label = `[${i + 1}/${records.length}]`;
        const parsed = CreatePropertySchema.safeParse(records[i]);

        if (!parsed.success) {
            validationFailed++;
            const title = records[i]?.title ?? records[i]?.slug ?? '(untitled)';
            console.log(`  ✗ ${label} "${title}" — schema validation failed:`);
            for (const issue of parsed.error.issues) {
                console.log(`      ${issue.path.join('.')}: ${issue.message}`);
            }
            continue;
        }

        const input = parsed.data;

        if (await slugExists(ORG_UUID, input.slug)) {
            alreadyExists++;
            console.log(`  = ${label} slug="${input.slug}" — already exists for this org, skipping`);
            continue;
        }

        const country = input.country ?? org.market;
        const currency = input.currency ?? MARKET_CURRENCY[org.market];
        const now = new Date().toISOString();
        const property = {
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
            brochure: input.brochure ?? null,
            image: input.image ?? null,
            images: input.images ?? [],
            description: input.description ?? null,
            payment: input.payment ?? null,
            units: (input.units ?? []).map((unit) => normalizeUnit(unit, currency)),
            created_at: now,
            updated_at: now,
        };

        console.log(`  + ${label} slug="${property.slug}" uuid=${property.uuid} title="${property.title}"`);

        if (EXECUTE) {
            try {
                await doc.send(
                    new TransactWriteCommand({
                        TransactItems: [
                            {
                                Put: {
                                    TableName: TABLE,
                                    Item: {
                                        PK: pk(ORG_UUID),
                                        SK: sk(property.uuid),
                                        ...gsiAttributes(ORG_UUID, property),
                                        data: JSON.stringify(property),
                                    },
                                },
                            },
                            {
                                Put: {
                                    TableName: TABLE,
                                    Item: { PK: slugPk(ORG_UUID, property.slug), SK: SLUG_SK, data: JSON.stringify({ property_uuid: property.uuid }) },
                                    ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
                                },
                            },
                        ],
                    }),
                );
                created++;
            } catch (error) {
                if (isConditionalCheckFailure(error)) {
                    alreadyExists++;
                    console.log(`      slug="${property.slug}" was created concurrently — skipped`);
                } else {
                    writeErrors++;
                    console.error(`      write failed: ${error.message}`);
                }
            }
        } else {
            created++;
        }
    }

    console.log(
        `[migrate-properties-from-json] total=${records.length} ${EXECUTE ? 'created' : 'would_create'}=${created} already_exists=${alreadyExists} validation_failed=${validationFailed} write_errors=${writeErrors} ${
            EXECUTE ? '(written)' : '(dry-run only — pass --execute to write)'
        }`,
    );

    if (writeErrors > 0) process.exitCode = 1;
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
