#!/usr/bin/env node
// Read-only check for backlogs/sync-templates: scans OrganisationTable's org-metadata partition
// (PK=ORG, SK begins_with META#) for any row still at the old 'pending' status, superseded by the
// creating-website/ready/website-failed/active/suspended lifecycle. Since each row stores the whole
// Organisation as one JSON-encoded `data` blob (not flat attributes), a plain DynamoDB
// FilterExpression on `status` can't match it directly — this parses `data` client-side instead.
//
// Read-only — does not modify anything. Any org found here predates this backlog and needs a
// manual, case-by-case decision (not a bulk migration, since org creation is the only writer of the
// initial status and this is net-new logic going forward).
//
// Usage:
//   AWS_PROFILE=<profile> AWS_REGION=<region> node scripts/find-pending-organisations.js [--table <name>]

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const args = process.argv.slice(2);

function flagValue(name, fallback) {
    const i = args.indexOf(name);
    return i !== -1 ? args[i + 1] : fallback;
}

const TABLE = flagValue('--table', process.env.ORGANISATION_TABLE_NAME || 'sale-sync-organisation');

const client = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(client);

async function main() {
    console.log(`[find-pending-organisations] table=${TABLE}`);

    let scanned = 0;
    let parseErrors = 0;
    const pending = [];
    let lastEvaluatedKey;

    do {
        const page = await doc.send(
            new QueryCommand({
                TableName: TABLE,
                KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
                ExpressionAttributeValues: { ':pk': 'ORG', ':prefix': 'META#' },
                ExclusiveStartKey: lastEvaluatedKey,
            }),
        );

        for (const item of page.Items ?? []) {
            scanned++;
            let org;
            try {
                org = JSON.parse(item.data);
            } catch (err) {
                parseErrors++;
                console.error(`  ! SK=${item.SK} — failed to JSON.parse 'data': ${err.message}`);
                continue;
            }
            if (org.status === 'pending') {
                pending.push(org);
            }
        }

        lastEvaluatedKey = page.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    console.log(`\nscanned=${scanned} pending_found=${pending.length} parse_errors=${parseErrors}`);
    for (const org of pending) {
        console.log(`  - id=${org.id} uuid=${org.uuid} name="${org.name}" business_category=${org.business_category} created_at=${org.created_at}`);
    }
    if (pending.length === 0) {
        console.log('Nothing at the old pending status — clean.');
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
