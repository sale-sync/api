#!/usr/bin/env node
// One-off fixup for backlogs/website/children/website-table-templates-themes: after migrating the
// template catalogue into WebsiteTable (see migrate-templates-to-website-table.js), staging and prod
// turned out to have the SAME template (name="Wello", business_category="real-estate") seeded under
// TWO DIFFERENT uuids:
//   prod (unprefixed sale-sync-website):    b4336669-634c-45e9-86b6-fff8df972bba
//   staging (staging-sale-sync-website):    a31801a5-9038-48b2-a137-42a74b459b20
//
// Policy (2026-07-26, your call): for simplicity, every environment should use the SAME uuid for the
// same template (and the same predefined theme, once those exist) — not independently-generated ids
// per environment. Canonical id chosen: b4336669-634c-45e9-86b6-fff8df972bba (already prod's).
//
// This script renames ONE template catalogue item in-place: reads the item at the old uuid's key,
// writes an identical item (same `data`, with `data.uuid` updated) under the new uuid's key, then
// deletes the old key. Only touches the Template catalogue (PK=TEMPLATE, SK=CATEGORY#...) — does NOT
// touch org-template membership (PK=ORG#..., SK=TEMPLATE#{uuid}) or org metadata's `template_id`. If
// any organisation in that table already references the OLD uuid as its active template_id or has a
// TEMPLATE# membership row keyed by it, those references are NOT rewritten by this script — check
// separately before running --execute if that's a concern (not expected to apply yet: only the
// staging demo org, wello-organisation, exists, and its template_id per backlogs/website/Wello.md is
// already the canonical b4336669 value, i.e. this script's target new-uuid — no membership rewrite
// needed for that org).
//
// SAFETY: dry-run by default — only prints what would change. Pass --execute to actually write.
//
// Usage:
//   AWS_PROFILE=<profile> AWS_REGION=<region> node scripts/align-template-id.js \
//     --table staging-sale-sync-website \
//     --category real-estate \
//     --old-uuid a31801a5-9038-48b2-a137-42a74b459b20 \
//     --new-uuid b4336669-634c-45e9-86b6-fff8df972bba \
//     [--execute]

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');

function flagValue(name, fallback) {
    const i = args.indexOf(name);
    return i !== -1 ? args[i + 1] : fallback;
}

const TABLE = flagValue('--table');
const CATEGORY = flagValue('--category');
const OLD_UUID = flagValue('--old-uuid');
const NEW_UUID = flagValue('--new-uuid');

if (!TABLE || !CATEGORY || !OLD_UUID || !NEW_UUID) {
    console.error('Usage: node scripts/align-template-id.js --table <name> --category <business_category> --old-uuid <uuid> --new-uuid <uuid> [--execute]');
    process.exit(1);
}

if (OLD_UUID === NEW_UUID) {
    console.error('--old-uuid and --new-uuid are the same — nothing to do');
    process.exit(1);
}

const client = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(client);

const oldKey = { PK: 'TEMPLATE', SK: `CATEGORY#${CATEGORY}#TEMPLATE#${OLD_UUID}` };
const newKey = { PK: 'TEMPLATE', SK: `CATEGORY#${CATEGORY}#TEMPLATE#${NEW_UUID}` };

async function main() {
    console.log(`[align-template-id] table=${TABLE} mode=${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}`);
    console.log(`  old: SK=${oldKey.SK}`);
    console.log(`  new: SK=${newKey.SK}`);

    const oldItemRes = await doc.send(new GetCommand({ TableName: TABLE, Key: oldKey }));
    if (!oldItemRes.Item) {
        console.log(`[align-template-id] no item found at old key — nothing to do (already migrated, or never existed here)`);
        return;
    }

    const newItemRes = await doc.send(new GetCommand({ TableName: TABLE, Key: newKey }));
    if (newItemRes.Item) {
        console.log(`[align-template-id] an item ALREADY EXISTS at the new key — refusing to overwrite. Resolve manually.`);
        process.exit(1);
    }

    let templateData;
    try {
        templateData = JSON.parse(oldItemRes.Item.data);
    } catch (err) {
        console.error(`[align-template-id] failed to JSON.parse 'data' on the old item: ${err.message}`);
        process.exit(1);
    }

    console.log(`  found: name=${templateData.name ?? '<unknown>'} business_category=${templateData.business_category ?? '<unknown>'}`);

    if (templateData.uuid && templateData.uuid !== OLD_UUID) {
        console.log(`  ! warning: data.uuid (${templateData.uuid}) doesn't match --old-uuid (${OLD_UUID}) — proceeding anyway, rewriting to --new-uuid`);
    }

    const updatedData = { ...templateData, uuid: NEW_UUID };
    const newItem = { ...oldItemRes.Item, PK: newKey.PK, SK: newKey.SK, data: JSON.stringify(updatedData) };

    console.log(`  + would Put new item at SK=${newKey.SK}`);
    console.log(`  - would Delete old item at SK=${oldKey.SK}`);

    if (EXECUTE) {
        await doc.send(new PutCommand({ TableName: TABLE, Item: newItem }));
        await doc.send(new DeleteCommand({ TableName: TABLE, Key: oldKey }));
        console.log(`[align-template-id] done — ${TABLE}'s "${templateData.name}" template now uses uuid=${NEW_UUID}`);
    } else {
        console.log(`[align-template-id] dry-run only — pass --execute to write`);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
