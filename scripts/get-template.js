#!/usr/bin/env node
// Fetches the full detail of a single Template catalogue entry in
// WebsiteTable (PK=TEMPLATE, SK=CATEGORY#{business_category}#TEMPLATE#{uuid})
// by its uuid — see backlogs/website/children/website-table-templates-themes,
// and scripts/list-templates.js for listing all of them first.
//
// Read-only — no --execute flag needed, this never writes.
//
// Table selection: pass --stage prod|staging (resolves to the known table
// names below) or --table <name> to target an arbitrary table directly
// (explicit override always wins over --stage). No hardcoded fallback — one
// of the two is required, since staging/prod are genuinely different tables.
//
// Lookup: pass --id <uuid> plus --category <business_category> for a direct,
// single-item GetCommand (cheapest — you already know both from
// list-templates.js's output). If you only have the uuid, omit --category
// and it falls back to a Query over PK=TEMPLATE, paginating until it finds
// the matching uuid (fine for a catalogue this small).
//
// Usage:
//   AWS_PROFILE=<profile> AWS_REGION=ap-southeast-2 node scripts/get-template.js \
//     --stage prod --id b4336669-634c-45e9-86b6-fff8df972bba --category real-estate
//
//   AWS_PROFILE=<profile> AWS_REGION=ap-southeast-2 node scripts/get-template.js \
//     --stage staging --id b4336669-634c-45e9-86b6-fff8df972bba
//
//   AWS_PROFILE=<profile> AWS_REGION=ap-southeast-2 node scripts/get-template.js \
//     --table sale-sync-website --id b4336669-634c-45e9-86b6-fff8df972bba --json

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const STAGE_TABLES = {
    prod: 'sale-sync-website',
    staging: 'staging-sale-sync-website',
};

const args = process.argv.slice(2);
const JSON_OUTPUT = args.includes('--json');

function flagValue(name, fallback) {
    const i = args.indexOf(name);
    return i !== -1 ? args[i + 1] : fallback;
}

const STAGE = flagValue('--stage');
const TABLE_OVERRIDE = flagValue('--table');
const ID = flagValue('--id');
const CATEGORY = flagValue('--category');

if (!ID) {
    console.error('--id <uuid> is required');
    process.exit(1);
}

if (STAGE && !TABLE_OVERRIDE && !STAGE_TABLES[STAGE]) {
    console.error(`--stage must be one of: ${Object.keys(STAGE_TABLES).join(', ')}`);
    process.exit(1);
}

const TABLE = TABLE_OVERRIDE ?? (STAGE ? STAGE_TABLES[STAGE] : undefined);
if (!TABLE) {
    console.error('Usage: node scripts/get-template.js --stage <prod|staging> --id <uuid> [--category <business_category>] [--json]');
    console.error('   or: node scripts/get-template.js --table <name> --id <uuid> [--category <business_category>] [--json]');
    process.exit(1);
}

const client = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(client);

async function getByCategory() {
    const key = { PK: 'TEMPLATE', SK: `CATEGORY#${CATEGORY}#TEMPLATE#${ID}` };
    const res = await doc.send(new GetCommand({ TableName: TABLE, Key: key }));
    return res.Item ?? null;
}

async function findById() {
    let lastEvaluatedKey;

    do {
        const page = await doc.send(
            new QueryCommand({
                TableName: TABLE,
                KeyConditionExpression: 'PK = :pk',
                ExpressionAttributeValues: { ':pk': 'TEMPLATE' },
                ExclusiveStartKey: lastEvaluatedKey,
            }),
        );

        const match = (page.Items ?? []).find((item) => {
            const skMatch = /^CATEGORY#(.+)#TEMPLATE#(.+)$/.exec(item.SK ?? '');
            return skMatch?.[2] === ID;
        });
        if (match) return match;

        lastEvaluatedKey = page.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    return null;
}

async function main() {
    const item = CATEGORY ? await getByCategory() : await findById();

    if (!item) {
        console.error(`[get-template] no template found for id=${ID}${CATEGORY ? ` category=${CATEGORY}` : ''} in ${TABLE}`);
        process.exit(1);
    }

    let data = {};
    try {
        data = JSON.parse(item.data);
    } catch (err) {
        console.error(`[get-template] found item but failed to JSON.parse 'data': ${err.message}`);
        data = null;
    }

    if (JSON_OUTPUT) {
        console.log(JSON.stringify({ PK: item.PK, SK: item.SK, ...(data ?? { raw_data: item.data }) }, null, 2));
        return;
    }

    console.log(`\n== Template ${ID} (${TABLE}) ==`);
    console.log(`  SK: ${item.SK}`);
    if (data) {
        for (const [k, v] of Object.entries(data)) {
            console.log(`  ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
        }
    } else {
        console.log(`  raw data (unparsed): ${item.data}`);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
