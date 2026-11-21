#!/usr/bin/env node
// Lists every Template catalogue entry in WebsiteTable (PK=TEMPLATE,
// SK=CATEGORY#{business_category}#TEMPLATE#{uuid}) — see
// backlogs/website/children/website-table-templates-themes.
//
// Read-only — no --execute flag needed, this never writes.
//
// Table selection: pass --stage prod|staging|both (resolves to the known
// table names below) or --table <name> to target an arbitrary table
// directly (explicit override always wins over --stage). No hardcoded
// fallback — one of the two is required, since staging/prod are genuinely
// different tables with different data.
//
// Optional --category <business_category> filters server-side
// (begins_with on SK) instead of listing every category.
//
// Usage:
//   AWS_PROFILE=<profile> AWS_REGION=ap-southeast-2 node scripts/list-templates.js --stage prod
//   AWS_PROFILE=<profile> AWS_REGION=ap-southeast-2 node scripts/list-templates.js --stage staging
//   AWS_PROFILE=<profile> AWS_REGION=ap-southeast-2 node scripts/list-templates.js --stage both
//   AWS_PROFILE=<profile> AWS_REGION=ap-southeast-2 node scripts/list-templates.js --stage prod --category real-estate
//   AWS_PROFILE=<profile> AWS_REGION=ap-southeast-2 node scripts/list-templates.js --table sale-sync-website
//   AWS_PROFILE=<profile> AWS_REGION=ap-southeast-2 node scripts/list-templates.js --stage both --json

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');

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
const CATEGORY = flagValue('--category');

if (STAGE && !TABLE_OVERRIDE && !STAGE_TABLES[STAGE]) {
    console.error(`--stage must be one of: ${Object.keys(STAGE_TABLES).join(', ')}, both`);
    process.exit(1);
}

let tables;
if (TABLE_OVERRIDE) {
    tables = [{ stage: null, table: TABLE_OVERRIDE }];
} else if (STAGE === 'both') {
    tables = Object.entries(STAGE_TABLES).map(([stage, table]) => ({ stage, table }));
} else if (STAGE) {
    tables = [{ stage: STAGE, table: STAGE_TABLES[STAGE] }];
} else {
    console.error('Usage: node scripts/list-templates.js --stage <prod|staging|both> [--category <business_category>] [--json]');
    console.error('   or: node scripts/list-templates.js --table <name> [--category <business_category>] [--json]');
    process.exit(1);
}

const client = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(client);

async function listTemplates(table) {
    const items = [];
    let lastEvaluatedKey;

    const keyConditionExpression = CATEGORY ? 'PK = :pk AND begins_with(SK, :skPrefix)' : 'PK = :pk';
    const expressionAttributeValues = CATEGORY
        ? { ':pk': 'TEMPLATE', ':skPrefix': `CATEGORY#${CATEGORY}#` }
        : { ':pk': 'TEMPLATE' };

    do {
        const page = await doc.send(
            new QueryCommand({
                TableName: table,
                KeyConditionExpression: keyConditionExpression,
                ExpressionAttributeValues: expressionAttributeValues,
                ExclusiveStartKey: lastEvaluatedKey,
            }),
        );

        for (const item of page.Items ?? []) {
            let data = {};
            try {
                data = JSON.parse(item.data);
            } catch {
                // leave data={} — still report the raw SK below so a malformed item is visible, not silently dropped
            }

            // SK = CATEGORY#{business_category}#TEMPLATE#{uuid}
            const skMatch = /^CATEGORY#(.+)#TEMPLATE#(.+)$/.exec(item.SK ?? '');

            items.push({
                table,
                uuid: data.uuid ?? skMatch?.[2] ?? null,
                name: data.name ?? null,
                business_category: data.business_category ?? skMatch?.[1] ?? null,
                sk: item.SK,
            });
        }

        lastEvaluatedKey = page.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    return items;
}

async function main() {
    const results = [];

    for (const { stage, table } of tables) {
        const items = await listTemplates(table);
        results.push({ stage, table, items });
    }

    if (JSON_OUTPUT) {
        console.log(JSON.stringify(tables.length === 1 ? results[0].items : results, null, 2));
        return;
    }

    for (const { stage, table, items } of results) {
        console.log(`\n== ${stage ? `${stage} (${table})` : table} — ${items.length} template(s) ==`);
        if (items.length === 0) {
            console.log('  (none)');
            continue;
        }
        for (const t of items) {
            console.log(`  - ${t.name ?? '(unnamed)'}  [category=${t.business_category}, uuid=${t.uuid}]`);
        }
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
