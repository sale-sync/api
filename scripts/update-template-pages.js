#!/usr/bin/env node
// One-off fixup: sets the `pages` array on a single Template catalogue item in WebsiteTable
// (PK=TEMPLATE, SK=CATEGORY#{business_category}#TEMPLATE#{uuid}). See
// libs/shared/src/types/template.ts's `Page`/`PageType`/`PageCategory` (added 2026-09-10) and
// docs/fsd/website/template-branding.md's Data Model section for the shape this validates against.
//
// Reads the `pages` array from a JSON file (see scripts/data/real-estate-template-pages.json for
// the "Real Estate" template's page list, derived from clients/home-thailand-estates/pages/ — note
// the `pageType`/`id`/`name` values there are the catalogue's own taxonomy, not required to match
// the literal `pageType` strings set in that project's actual pages/*.ts files).
//
// Updates ONLY the `data.pages` field of a single Template item, in place — same uuid, same SK,
// same every other field.
//
// SAFETY: dry-run by default — only prints what would change. Pass --execute to actually write.
//
// Usage:
//   AWS_PROFILE=<profile> AWS_REGION=<region> node scripts/update-template-pages.js \
//     --stage <prod|staging> \
//     --category real-estate \
//     --uuid b4336669-634c-45e9-86b6-fff8df972bba \
//     --pages-file scripts/data/real-estate-template-pages.json \
//     [--execute]
//
//   or --table <name> instead of --stage, for an arbitrary table name.

const fs = require('fs');
const path = require('path');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const STAGE_TABLES = {
    prod: 'sale-sync-website',
    staging: 'staging-sale-sync-website',
};

const VALID_PAGE_TYPES = [
    'default',
    'timetable',
    'available-on',
    'blocknote',
    'property-map-view',
    'agent-list',
    'property-search',
    'real-estate-home',
    'real-estate-agents',
    'real-estate-map-view',
    'real-estate-properties',
    'faq',
    'locations',
];
const VALID_PAGE_CATEGORIES = ['normal', 'feature'];
const VALID_PAGE_RENDERS = ['csr', 'ssr', 'hybrid'];
// Which regeneration Lambda handles this page's publish step — see libs/shared/src/types/
// template.ts's PageGenerator. null = no generator wired up yet (every csr page, plus any
// ssr/hybrid page whose generator isn't built yet).
const VALID_GENERATORS = ['blocknote-singleton'];

const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');

function flagValue(name, fallback) {
    const i = args.indexOf(name);
    return i !== -1 ? args[i + 1] : fallback;
}

const STAGE = flagValue('--stage');
const TABLE_OVERRIDE = flagValue('--table');
const CATEGORY = flagValue('--category');
const UUID = flagValue('--uuid');
const PAGES_FILE = flagValue('--pages-file');

if (STAGE && !TABLE_OVERRIDE && !STAGE_TABLES[STAGE]) {
    console.error(`--stage must be one of: ${Object.keys(STAGE_TABLES).join(', ')}`);
    process.exit(1);
}

const TABLE = TABLE_OVERRIDE ?? (STAGE ? STAGE_TABLES[STAGE] : undefined);

if (!TABLE || !CATEGORY || !UUID || !PAGES_FILE) {
    console.error('Usage: node scripts/update-template-pages.js --stage <prod|staging> --category <business_category> --uuid <uuid> --pages-file <path> [--execute]');
    console.error('   or: node scripts/update-template-pages.js --table <name> --category <business_category> --uuid <uuid> --pages-file <path> [--execute]');
    process.exit(1);
}

let pages;
try {
    pages = JSON.parse(fs.readFileSync(path.resolve(PAGES_FILE), 'utf8'));
} catch (err) {
    console.error(`[update-template-pages] failed to read/parse --pages-file: ${err.message}`);
    process.exit(1);
}

if (!Array.isArray(pages)) {
    console.error('[update-template-pages] --pages-file must contain a JSON array');
    process.exit(1);
}

for (const [i, p] of pages.entries()) {
    const errs = [];
    if (typeof p?.id !== 'string' || !p.id) errs.push('missing/invalid id');
    if (typeof p?.name !== 'string' || !p.name) errs.push('missing/invalid name');
    if (!VALID_PAGE_TYPES.includes(p?.pageType)) errs.push(`invalid pageType "${p?.pageType}" (expected one of: ${VALID_PAGE_TYPES.join(', ')})`);
    if (!VALID_PAGE_CATEGORIES.includes(p?.pageCategory)) errs.push(`invalid pageCategory "${p?.pageCategory}" (expected one of: ${VALID_PAGE_CATEGORIES.join(', ')})`);
    if (!VALID_PAGE_RENDERS.includes(p?.render)) errs.push(`invalid render "${p?.render}" (expected one of: ${VALID_PAGE_RENDERS.join(', ')})`);
    if (p?.generator !== null && !VALID_GENERATORS.includes(p?.generator)) errs.push(`invalid generator "${p?.generator}" (expected null or one of: ${VALID_GENERATORS.join(', ')})`);
    if (errs.length) {
        console.error(`[update-template-pages] pages[${i}] (${p?.id ?? '?'}): ${errs.join('; ')}`);
        process.exit(1);
    }
}

const client = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(client);

const key = { PK: 'TEMPLATE', SK: `CATEGORY#${CATEGORY}#TEMPLATE#${UUID}` };

async function main() {
    console.log(`[update-template-pages] table=${TABLE} mode=${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}`);
    console.log(`  key: SK=${key.SK}`);
    console.log(`  pages (${pages.length}): ${pages.map((p) => `${p.id} (${p.pageType}/${p.pageCategory}/${p.render}/gen=${p.generator})`).join(', ')}`);

    const res = await doc.send(new GetCommand({ TableName: TABLE, Key: key }));
    if (!res.Item) {
        console.log(`[update-template-pages] no item found at that key — nothing to do`);
        return;
    }

    let templateData;
    try {
        templateData = JSON.parse(res.Item.data);
    } catch (err) {
        console.error(`[update-template-pages] failed to JSON.parse 'data': ${err.message}`);
        process.exit(1);
    }

    console.log(`  existing pages: ${templateData.pages ? JSON.stringify(templateData.pages) : '(none)'}`);

    const updatedData = { ...templateData, pages };

    if (EXECUTE) {
        await doc.send(
            new UpdateCommand({
                TableName: TABLE,
                Key: key,
                UpdateExpression: 'SET #data = :data',
                ExpressionAttributeNames: { '#data': 'data' },
                ExpressionAttributeValues: { ':data': JSON.stringify(updatedData) },
            }),
        );
        console.log(`[update-template-pages] done — ${TABLE}'s template "${templateData.name}" now has ${pages.length} pages`);
    } else {
        console.log(`[update-template-pages] dry-run only — pass --execute to write`);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
