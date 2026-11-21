#!/usr/bin/env node
// One-off migration for backlogs/website/children/website-table-templates-themes: moves the
// global template catalogue (PK=TEMPLATE, SK=CATEGORY#{business_category}#TEMPLATE#{uuid}) out of
// OrganisationTable and into WebsiteTable, which is now the single-table home for every
// website-related record (see docs/api/dynamodb/access-patterns/template.md, updated 2026-07-26).
//
// Only the catalogue moves. Org-template membership (PK=ORG#{uuid}, SK=TEMPLATE#{uuid}) and the
// old per-org ThemeConfig rows (PK=ORG#{uuid}, SK=THEME#{uuid}) are untouched — membership stays in
// OrganisationTable by design, and ThemeConfig was already dead code removed from the API (nothing
// reads/writes THEME#{template_uuid} rows anymore; this script does not touch them).
//
// Copies the item verbatim (whatever attributes it actually has — PK, SK, data, any extras) so it
// doesn't need to know the exact shape. Skips (does not overwrite) any key that already exists in
// WebsiteTable, so the script is safe to re-run. Source rows are left in place unless you pass
// --delete-source — copy first, verify WebsiteTable looks right, then re-run with --delete-source
// once you're confident, so a bad copy is always recoverable from the untouched source.
//
// SAFETY: dry-run by default — only prints what would change. Pass --execute to actually write.
// Always run against staging first.
//
// Usage:
//   AWS_PROFILE=<profile> AWS_REGION=<region> node scripts/migrate-templates-to-website-table.js [--execute] [--delete-source] [--source-table <name>] [--dest-table <name>]
//
// Typical flow:
//   1. node scripts/migrate-templates-to-website-table.js
//        → dry run, review the printed diff
//   2. node scripts/migrate-templates-to-website-table.js --execute
//        → copies into WebsiteTable, source untouched
//   3. Verify (app / a manual GetItem) that WebsiteTable serves the catalogue correctly
//   4. node scripts/migrate-templates-to-website-table.js --execute --delete-source
//        → re-run: already-copied items are skipped as "already migrated", then deleted from
//          OrganisationTable now that WebsiteTable is confirmed good

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, PutCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');
const DELETE_SOURCE = args.includes('--delete-source');

function flagValue(name, fallback) {
    const i = args.indexOf(name);
    return i !== -1 ? args[i + 1] : fallback;
}

const SOURCE_TABLE = flagValue('--source-table', process.env.ORGANISATION_TABLE_NAME || 'sale-sync-organisation');
const DEST_TABLE = flagValue('--dest-table', process.env.WEBSITE_TABLE_NAME || 'sale-sync-website');

if (DELETE_SOURCE && !EXECUTE) {
    console.error('--delete-source requires --execute (refusing to delete during a dry run)');
    process.exit(1);
}

const client = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(client);

async function itemExists(tableName, key) {
    // Cheap existence check via a conditional-write dry probe isn't available without writing, so
    // just Query the single item's exact key range instead of a GetCommand — keeps this script to
    // the two command types already imported above plus one more would be needed for Get. A Query
    // with KeyConditionExpression on PK+SK is equivalent to a GetCommand for a single known key.
    const res = await doc.send(
        new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: 'PK = :pk AND SK = :sk',
            ExpressionAttributeValues: { ':pk': key.PK, ':sk': key.SK },
            Limit: 1,
        }),
    );
    return (res.Items ?? []).length > 0;
}

async function main() {
    console.log(
        `[migrate-templates-to-website-table] source=${SOURCE_TABLE} dest=${DEST_TABLE} mode=${
            EXECUTE ? 'EXECUTE' : 'DRY-RUN'
        }${DELETE_SOURCE ? ' delete-source=true' : ''}`,
    );

    let scanned = 0;
    let copied = 0;
    let alreadyPresent = 0;
    let deleted = 0;
    let lastEvaluatedKey;

    do {
        const page = await doc.send(
            new QueryCommand({
                TableName: SOURCE_TABLE,
                KeyConditionExpression: 'PK = :pk',
                ExpressionAttributeValues: { ':pk': 'TEMPLATE' },
                ExclusiveStartKey: lastEvaluatedKey,
            }),
        );

        for (const item of page.Items ?? []) {
            scanned++;

            let name = item.SK;
            try {
                name = JSON.parse(item.data)?.name ?? item.SK;
            } catch {
                // fall back to raw SK if 'data' isn't valid JSON — still migrate the item as-is
            }

            const key = { PK: item.PK, SK: item.SK };
            const exists = await itemExists(DEST_TABLE, key);

            if (exists) {
                alreadyPresent++;
                console.log(`  = SK=${item.SK} (${name}) — already present in ${DEST_TABLE}, skipping copy`);
            } else {
                copied++;
                console.log(`  + SK=${item.SK} (${name}) — ${SOURCE_TABLE} -> ${DEST_TABLE}`);
                if (EXECUTE) {
                    await doc.send(new PutCommand({ TableName: DEST_TABLE, Item: item }));
                }
            }

            if (DELETE_SOURCE && (exists || EXECUTE)) {
                deleted++;
                console.log(`  - SK=${item.SK} (${name}) — deleting from ${SOURCE_TABLE}`);
                await doc.send(new DeleteCommand({ TableName: SOURCE_TABLE, Key: key }));
            }
        }

        lastEvaluatedKey = page.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    console.log(
        `[migrate-templates-to-website-table] scanned=${scanned} copied=${copied} already_present=${alreadyPresent} deleted_from_source=${deleted} ${
            EXECUTE ? '(written)' : '(dry-run only — pass --execute to write)'
        }`,
    );
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
