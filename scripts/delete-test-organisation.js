#!/usr/bin/env node
// One-off cleanup for test organisations created while end-to-end testing
// backlogs/sync-templates's init-website/website-stack-complete pipeline. Deletes ONLY
// org-specific rows: org metadata (PK=ORG, SK=META#{uuid}), the slug->uuid lookup
// (PK=ORG#ID#{id}, SK=META), and any membership rows under the org's own partition
// (PK=ORG#{uuid}, SK=USER#{user_id}). Does NOT touch USER#{email} rows (META or the
// inverted-index USER#{user_id} row) — those are the actual user account, shared across every
// org they belong to, and must survive this cleanup.
//
// Does NOT touch WebsiteTable, the org's CloudFormation stack, or its S3 bucket — those are
// separate cleanup steps (see backlogs/sync-templates's tasks.md).
//
// SAFETY: dry-run by default — only prints what would be deleted. Pass --execute to actually
// delete. Always run against staging first.
//
// Usage:
//   AWS_PROFILE=<profile> AWS_REGION=<region> node scripts/delete-test-organisation.js <organisation_id> [<organisation_id> ...] [--execute] [--table <name>]

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, QueryCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');

function flagValue(name, fallback) {
    const i = args.indexOf(name);
    return i !== -1 ? args[i + 1] : fallback;
}

const TABLE = flagValue('--table', process.env.ORGANISATION_TABLE_NAME || 'sale-sync-organisation');
const ORG_IDS = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--table');

if (ORG_IDS.length === 0) {
    console.error('Usage: node scripts/delete-test-organisation.js <organisation_id> [<organisation_id> ...] [--execute] [--table <name>]');
    process.exit(1);
}

const client = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(client);

async function deleteOrganisation(orgId) {
    console.log(`\n=== ${orgId} (table=${TABLE}) ===`);

    const slugRes = await doc.send(new GetCommand({ TableName: TABLE, Key: { PK: `ORG#ID#${orgId}`, SK: 'META' } }));
    if (!slugRes.Item) {
        console.log(`  no organisation found for id=${orgId} — nothing to do`);
        return;
    }
    const { uuid } = JSON.parse(slugRes.Item.data);
    console.log(`  resolved uuid=${uuid}`);

    const membershipRes = await doc.send(
        new QueryCommand({
            TableName: TABLE,
            KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
            ExpressionAttributeValues: { ':pk': `ORG#${uuid}`, ':prefix': 'USER#' },
        }),
    );
    const membershipKeys = (membershipRes.Items ?? []).map((item) => ({ PK: item.PK, SK: item.SK }));

    const keysToDelete = [{ PK: 'ORG', SK: `META#${uuid}` }, { PK: `ORG#ID#${orgId}`, SK: 'META' }, ...membershipKeys];

    for (const key of keysToDelete) {
        console.log(`  - would delete PK=${key.PK} SK=${key.SK}`);
    }

    if (EXECUTE) {
        for (const key of keysToDelete) {
            await doc.send(new DeleteCommand({ TableName: TABLE, Key: key }));
        }
        console.log(`  ✓ deleted ${keysToDelete.length} item(s)`);
    }
}

async function main() {
    console.log(`[delete-test-organisation] mode=${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}`);
    for (const orgId of ORG_IDS) {
        await deleteOrganisation(orgId);
    }
    if (!EXECUTE) {
        console.log('\n[delete-test-organisation] dry-run only — pass --execute to delete');
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
