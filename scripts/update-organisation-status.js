#!/usr/bin/env node
// One-off fix for backlogs/sync-templates: updates a single organisation's `status` field.
// Organisation is stored as one JSON-encoded `data` blob per row (PK=ORG, SK=META#{uuid}), not flat
// attributes, so this does a read-modify-write (parse `data`, patch `status`, re-stringify) rather
// than a plain UpdateExpression on a top-level attribute — same pattern
// organisation.service.ts/website-stack-complete.ts already use for status updates.
//
// Intended for manually fixing orgs that predate this backlog's status lifecycle (e.g. a client
// site that was already manually deployed and registered before automated provisioning existed —
// its org row would still show the old 'pending' value, which now means "awaiting website
// provisioning," not "awaiting admin approval" like it used to). Not a bulk migration tool —
// deliberately one organisation_id at a time, so each case gets looked at individually.
//
// SAFETY: dry-run by default — only prints the before/after diff. Pass --execute to actually write.
//
// Usage:
//   AWS_PROFILE=<profile> AWS_REGION=<region> node scripts/update-organisation-status.js <organisation_id> <new_status> [--execute] [--table <name>]

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');

function flagValue(name, fallback) {
    const i = args.indexOf(name);
    return i !== -1 ? args[i + 1] : fallback;
}

const TABLE = flagValue('--table', process.env.ORGANISATION_TABLE_NAME || 'sale-sync-organisation');
const [ORG_ID, NEW_STATUS] = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--table');

const VALID_STATUSES = ['creating-website', 'ready', 'website-failed', 'active', 'suspended'];

if (!ORG_ID || !NEW_STATUS) {
    console.error('Usage: node scripts/update-organisation-status.js <organisation_id> <new_status> [--execute] [--table <name>]');
    process.exit(1);
}
if (!VALID_STATUSES.includes(NEW_STATUS)) {
    console.error(`new_status must be one of: ${VALID_STATUSES.join(', ')} (got: ${NEW_STATUS})`);
    process.exit(1);
}

const client = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(client);

async function main() {
    console.log(`[update-organisation-status] table=${TABLE} mode=${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}`);

    const slugRes = await doc.send(new GetCommand({ TableName: TABLE, Key: { PK: `ORG#ID#${ORG_ID}`, SK: 'META' } }));
    if (!slugRes.Item) {
        console.log(`no organisation found for id=${ORG_ID} — nothing to do`);
        return;
    }
    const { uuid } = JSON.parse(slugRes.Item.data);

    const metaRes = await doc.send(new GetCommand({ TableName: TABLE, Key: { PK: 'ORG', SK: `META#${uuid}` } }));
    if (!metaRes.Item) {
        console.log(`org metadata row not found for uuid=${uuid} — nothing to do`);
        return;
    }
    const org = JSON.parse(metaRes.Item.data);

    console.log(`  id=${org.id} uuid=${org.uuid} name="${org.name}"`);
    console.log(`  status: "${org.status}" -> "${NEW_STATUS}"`);

    if (org.status === NEW_STATUS) {
        console.log('  already at that status — nothing to do');
        return;
    }

    const updated = { ...org, status: NEW_STATUS };

    if (EXECUTE) {
        await doc.send(
            new UpdateCommand({
                TableName: TABLE,
                Key: { PK: 'ORG', SK: `META#${uuid}` },
                UpdateExpression: 'SET #data = :data',
                ExpressionAttributeNames: { '#data': 'data' },
                ExpressionAttributeValues: { ':data': JSON.stringify(updated) },
            }),
        );
        console.log(`  ✓ updated`);
    } else {
        console.log('  dry-run only — pass --execute to write');
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
