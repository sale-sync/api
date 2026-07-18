#!/usr/bin/env node
// One-off backfill for the UnitTag rename 'buy' -> 'sell' (see
// api/packages/src/types/property.ts). Existing Property items persisted
// before this rename may still have units with tag: 'buy', which the
// updated Zod schemas (dtos/property.ts, openapi/paths/properties.ts) no
// longer accept, and which the app/theme-maker frontends no longer
// recognize (they now check for 'sell').
//
// Scans PROPERTY_TABLE_NAME for items whose SK begins with "PROPERTY#"
// (skips the SLUG# pointer items, whose SK is the literal "META" — see
// property.service.ts's `sk`/`slugPk`/`SLUG_SK`). The whole Property object
// (including its `units` array) is stored as a JSON string under a single
// `data` attribute (see property.service.ts's `data: JSON.stringify(property)`
// on write, and `JSON.parse(item.data)` on read) — NOT as flat top-level
// attributes. This script parses `data`, rewrites any unit with tag: 'buy'
// to tag: 'sell', and writes the whole `data` blob back via the same
// `SET #data = :data` pattern property.service.ts itself uses for updates.
// GSI keys (GSI1PK/SK, GSI2PK, GSI3PK/SK) are untouched — they're derived
// from country/area/type/region, none of which this migration changes.
//
// SAFETY: dry-run by default — only prints what would change. Pass
// --execute to actually write. Always run against staging first.
//
// Usage:
//   AWS_PROFILE=<profile> AWS_REGION=<region> node scripts/migrate-buy-to-sell-tag.js [--execute] [--table <name>]

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");

const args = process.argv.slice(2);
const EXECUTE = args.includes("--execute");
const tableFlagIndex = args.indexOf("--table");
const TABLE =
  tableFlagIndex !== -1
    ? args[tableFlagIndex + 1]
    : process.env.PROPERTY_TABLE_NAME || "sale-sync-properties";

const client = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(client);

async function main() {
  console.log(`[migrate-buy-to-sell-tag] table=${TABLE} mode=${EXECUTE ? "EXECUTE" : "DRY-RUN"}`);

  let scanned = 0;
  let itemsNeedingUpdate = 0;
  let unitsUpdated = 0;
  let parseErrors = 0;
  let lastEvaluatedKey;

  do {
    const page = await doc.send(
      new ScanCommand({
        TableName: TABLE,
        FilterExpression: "begins_with(SK, :propertyPrefix)",
        ExpressionAttributeValues: { ":propertyPrefix": "PROPERTY#" },
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );

    for (const item of page.Items ?? []) {
      scanned++;

      let property;
      try {
        property = JSON.parse(item.data);
      } catch (err) {
        parseErrors++;
        console.error(`  ! PK=${item.PK} SK=${item.SK} — failed to JSON.parse 'data': ${err.message}`);
        continue;
      }

      const units = Array.isArray(property.units) ? property.units : [];
      const buyUnits = units.filter((u) => u && u.tag === "buy");
      if (buyUnits.length === 0) continue;

      itemsNeedingUpdate++;
      unitsUpdated += buyUnits.length;
      const updatedProperty = {
        ...property,
        units: units.map((u) => (u && u.tag === "buy" ? { ...u, tag: "sell" } : u)),
      };

      console.log(
        `  PK=${item.PK} SK=${item.SK} (slug=${property.slug ?? "<none>"}) — ${buyUnits.length} unit(s) 'buy' -> 'sell'`,
      );

      if (EXECUTE) {
        await doc.send(
          new UpdateCommand({
            TableName: TABLE,
            Key: { PK: item.PK, SK: item.SK },
            UpdateExpression: "SET #data = :data",
            ExpressionAttributeNames: { "#data": "data" },
            ExpressionAttributeValues: { ":data": JSON.stringify(updatedProperty) },
          }),
        );
      }
    }

    lastEvaluatedKey = page.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  console.log(
    `[migrate-buy-to-sell-tag] scanned=${scanned} items_needing_update=${itemsNeedingUpdate} units_updated=${unitsUpdated} parse_errors=${parseErrors} ${
      EXECUTE ? "(written)" : "(dry-run only — pass --execute to write)"
    }`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
