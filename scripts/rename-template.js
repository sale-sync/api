#!/usr/bin/env node
// One-off fixup for backlogs/website/children/website-table-templates-themes: the real-estate
// template's catalogue entry (WebsiteTable, PK=TEMPLATE, SK=CATEGORY#real-estate#TEMPLATE#{uuid})
// was seeded with name="Wello" — the underlying theme-maker/ theme's brand name, not the catalogue
// entry's own name. Per the BRD (docs/brd/business-categories.md, updated 2026-07-26), a template's
// catalogue name should be the business category's display name ("Real Estate"); the theme that
// implements it keeps its own separate brand name ("Wello", theme-maker/real-estate/) — the two are
// distinct concepts that happened to share a name in the seed data.
//
// Updates ONLY the `data.name` field of a single Template item, in place — same uuid, same SK, same
// every other field. Does not touch OrganisationTemplate membership, org metadata, or theme-maker
// itself (the theme keeps being called "Wello").
//
// SAFETY: dry-run by default — only prints what would change. Pass --execute to actually write.
//
// Usage:
//   AWS_PROFILE=<profile> AWS_REGION=<region> node scripts/rename-template.js \
//     --table <sale-sync-website|staging-sale-sync-website> \
//     --category real-estate \
//     --uuid b4336669-634c-45e9-86b6-fff8df972bba \
//     --name "Real Estate" \
//     [--execute]

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');

function flagValue(name, fallback) {
    const i = args.indexOf(name);
    return i !== -1 ? args[i + 1] : fallback;
}

const TABLE = flagValue('--table');
const CATEGORY = flagValue('--category');
const UUID = flagValue('--uuid');
const NEW_NAME = flagValue('--name');

if (!TABLE || !CATEGORY || !UUID || !NEW_NAME) {
    console.error('Usage: node scripts/rename-template.js --table <name> --category <business_category> --uuid <uuid> --name <new name> [--execute]');
    process.exit(1);
}

const client = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(client);

const key = { PK: 'TEMPLATE', SK: `CATEGORY#${CATEGORY}#TEMPLATE#${UUID}` };

async function main() {
    console.log(`[rename-template] table=${TABLE} mode=${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}`);
    console.log(`  key: SK=${key.SK}`);

    const res = await doc.send(new GetCommand({ TableName: TABLE, Key: key }));
    if (!res.Item) {
        console.log(`[rename-template] no item found at that key — nothing to do`);
        return;
    }

    let templateData;
    try {
        templateData = JSON.parse(res.Item.data);
    } catch (err) {
        console.error(`[rename-template] failed to JSON.parse 'data': ${err.message}`);
        process.exit(1);
    }

    if (templateData.name === NEW_NAME) {
        console.log(`[rename-template] name is already "${NEW_NAME}" — nothing to do`);
        return;
    }

    console.log(`  name: "${templateData.name}" -> "${NEW_NAME}"`);

    const updatedData = { ...templateData, name: NEW_NAME };

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
        console.log(`[rename-template] done — ${TABLE}'s template now has name="${NEW_NAME}"`);
    } else {
        console.log(`[rename-template] dry-run only — pass --execute to write`);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
