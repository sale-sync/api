#!/usr/bin/env node
// One-off migration for backlogs/real-estate-template/children/property-detail-pages/children/
// property-unit-api: properties and units moved to a draft/published model. `data` is now the
// dashboard's draft and the new `published` attribute is the snapshot the public website reads
// (queries-api serves ONLY `published`). Every property written before this change has no `published`
// attribute, so without this migration every existing property (and unit) disappears from the public
// site the moment queries-api is deployed.
//
// For each property item that has no `published` attribute, copies its current `data` into
// `published` (units included, so current live units stay live) and stamps `published_at`. Items that
// already have a `published` attribute are left alone, so it is safe to run more than once.
//
// ORDER: run it BEFORE deploying api + queries-api (the old code ignores the extra attributes), then
// run it again right after the deploy to pick up anything created or edited in between. Never edits
// `data`, the GSIs or the slug lookup items.
//
// SAFETY: dry-run by default — only prints what would change. Pass --execute to actually write.
//
// Usage:
//   AWS_PROFILE=<profile> AWS_REGION=<region> node scripts/migrate-properties-to-published.js \
//     --table staging-sale-sync-properties \
//     [--execute]

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');

function flagValue(name, fallback) {
    const i = args.indexOf(name);
    return i !== -1 ? args[i + 1] : fallback;
}

const TABLE = flagValue('--table');
if (!TABLE) {
    console.error('Usage: node scripts/migrate-properties-to-published.js --table <table> [--execute]');
    process.exit(1);
}

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Property items are the ones whose PK ends with "#PROPERTY" and SK starts with "PROPERTY#" — the
// slug lookup items (PK ...#PROPERTY#SLUG#<slug>, SK META) carry no property data and are skipped.
const isPropertyItem = (item) => /#PROPERTY$/.test(item.PK) && /^PROPERTY#/.test(item.SK);

async function main() {
    console.log(`${EXECUTE ? 'EXECUTE' : 'DRY RUN'} against ${TABLE}`);
    const now = new Date().toISOString();
    let scanned = 0;
    let migrated = 0;
    let skipped = 0;
    let startKey;

    do {
        const page = await db.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey: startKey }));
        for (const item of page.Items ?? []) {
            if (!isPropertyItem(item)) continue;
            scanned += 1;

            if (typeof item.published === 'string') {
                skipped += 1;
                continue;
            }

            const property = JSON.parse(item.data);
            console.log(`  ${item.PK} ${item.SK}  "${property.title}"  (${(property.units ?? []).length} units)`);
            migrated += 1;

            if (EXECUTE) {
                await db.send(
                    new UpdateCommand({
                        TableName: TABLE,
                        Key: { PK: item.PK, SK: item.SK },
                        UpdateExpression: 'SET published = :published, published_at = :publishedAt',
                        // Never clobber a published snapshot written by a concurrent publish.
                        ConditionExpression: 'attribute_not_exists(published)',
                        ExpressionAttributeValues: { ':published': item.data, ':publishedAt': now },
                    }),
                );
            }
        }
        startKey = page.LastEvaluatedKey;
    } while (startKey);

    console.log(`Scanned ${scanned} properties: ${migrated} ${EXECUTE ? 'migrated' : 'would be migrated'}, ${skipped} already had a published copy.`);
    if (!EXECUTE && migrated > 0) console.log('Re-run with --execute to write.');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
