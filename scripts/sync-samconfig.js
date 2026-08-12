#!/usr/bin/env node
// Compiles env.<name>.json ("Parameters" block) into samconfig.toml's
// parameter_overrides, since `sam deploy` ignores --env-vars files and only
// reads CloudFormation parameters from samconfig.toml.
//
// Usage: node scripts/sync-samconfig.js [envName] [tomlSection] [mode]
//   envName     defaults to "prod"      -> reads <mode's env prefix>.<envName>.json
//   tomlSection defaults to "default.deploy.parameters"
//   mode        defaults to "client"    -> "client" (env.*.json/samconfig.toml,
//               customer-facing API), "admin" (admin.env.*.json/
//               admin.samconfig.toml, staff-facing admin API — own template/stack,
//               smaller Parameters block, see admin.template.yaml), or "queries"
//               (queries.env.*.json/queries.samconfig.toml, public unauthenticated
//               read API — own template/stack, see queries.template.yaml)

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const envName = process.argv[2] || "prod";
const tomlSection = process.argv[3] || "default.deploy.parameters";
const mode = process.argv[4] || "client";

// Keep each mode's map in sync with its own template.yaml's `Parameters:` block.
// ORGANISATION_TABLE_NAME/AUTH_TABLE_NAME/MEDIA_TABLE_NAME/MEDIA_BUCKET_NAME/
// PROPERTY_TABLE_NAME used to be intentionally excluded from the client map because
// they were CloudFormation-managed via nested stacks (OrganisationInfraStack /
// AuthInfraStack / MediaInfraStack / PropertiesInfraStack), not plain parameters.
// Those nested stacks are gone — infra now lives in the standalone ss/infra stack
// (see ss/docs/infra/runbook.md) — and template.yaml takes these as plain
// Parameters, so they're included below like everything else.
const MODE_CONFIG = {
  client: {
    envPrefix: "env",
    tomlFile: "samconfig.toml",
    paramKeyMap: {
      RESOURCE_PREFIX: "ResourcePrefix",
      BLOCK_TABLE_NAME: "BlockTableName",
      COGNITO_URL: "CognitoUrl",
      CLIENT_ID: "ClientId",
      CLIENT_SECRET: "ClientSecret",
      COGNITO_CALLBACK_URL: "CognitoCallbackUrl",
      AUTH_TABLE_NAME: "AuthTableName",
      ORGANISATION_TABLE_NAME: "OrganisationTableName",
      MEDIA_TABLE_NAME: "MediaTableName",
      MEDIA_BUCKET_NAME: "MediaBucketName",
      PROPERTY_TABLE_NAME: "PropertyTableName",
      INIT_WEBSITE_FUNCTION_NAME: "InitWebsiteFunctionName",
      WEBSITE_TABLE_NAME: "WebsiteTableName",
    },
  },
  admin: {
    envPrefix: "admin.env",
    tomlFile: "admin.samconfig.toml",
    // admin.template.yaml's Parameters block (TableName is the OrganisationTable —
    // admin only ever reads/writes that one table; CognitoCallbackUrl feeds the new
    // apps/admin-api/auth app's OIDC redirect_uri).
    paramKeyMap: {
      TABLE_NAME: "TableName",
      COGNITO_URL: "CognitoUrl",
      CLIENT_ID: "ClientId",
      CLIENT_SECRET: "ClientSecret",
      COGNITO_CALLBACK_URL: "CognitoCallbackUrl",
    },
  },
  queries: {
    envPrefix: "queries.env",
    tomlFile: "queries.samconfig.toml",
    // queries.template.yaml's Parameters block is just these two (both existing
    // tables, read-only access — queries never writes anything).
    paramKeyMap: {
      ORGANISATION_TABLE_NAME: "OrganisationTableName",
      PROPERTY_TABLE_NAME: "PropertyTableName",
    },
  },
};

if (!MODE_CONFIG[mode]) {
  console.error(`ERROR: unknown mode "${mode}" — expected one of: ${Object.keys(MODE_CONFIG).join(", ")}`);
  process.exit(1);
}

const { envPrefix, tomlFile, paramKeyMap: PARAM_KEY_MAP } = MODE_CONFIG[mode];
const envPath = path.join(ROOT, `${envPrefix}.${envName}.json`);
const tomlPath = path.join(ROOT, tomlFile);

function main() {
  if (!fs.existsSync(envPath)) {
    console.error(`ERROR: ${path.relative(ROOT, envPath)} not found`);
    process.exit(1);
  }
  if (!fs.existsSync(tomlPath)) {
    console.error(`ERROR: ${path.relative(ROOT, tomlPath)} not found`);
    process.exit(1);
  }

  const env = JSON.parse(fs.readFileSync(envPath, "utf8"));
  const parameters = env.Parameters || {};

  const overrides = [];
  const missing = [];
  for (const [envKey, cfnKey] of Object.entries(PARAM_KEY_MAP)) {
    if (parameters[envKey] === undefined) {
      missing.push(envKey);
      continue;
    }
    overrides.push(`ParameterKey=${cfnKey},ParameterValue=${parameters[envKey]}`);
  }

  if (overrides.length === 0) {
    console.error(
      `ERROR: none of the expected keys (${Object.keys(PARAM_KEY_MAP).join(", ")}) were found in ${path.relative(ROOT, envPath)}`
    );
    process.exit(1);
  }
  if (missing.length > 0) {
    console.warn(`WARN: missing keys in ${path.relative(ROOT, envPath)}, skipped: ${missing.join(", ")}`);
  }

  const overridesBlock =
    "parameter_overrides = [\n" +
    overrides.map((line) => `  "${line}"`).join(",\n") +
    "\n]";

  let toml = fs.readFileSync(tomlPath, "utf8");

  const sectionHeader = `[${tomlSection}]`;
  const sectionIdx = toml.indexOf(sectionHeader);
  if (sectionIdx === -1) {
    console.error(`ERROR: section ${sectionHeader} not found in ${path.relative(ROOT, tomlPath)}`);
    process.exit(1);
  }

  const overridesRegex = /parameter_overrides\s*=\s*\[[\s\S]*?\]/;
  const sectionText = toml.slice(sectionIdx);

  let newToml;
  if (overridesRegex.test(sectionText)) {
    newToml =
      toml.slice(0, sectionIdx) +
      sectionText.replace(overridesRegex, overridesBlock);
  } else {
    // No existing parameter_overrides in this section: append it at the end of file
    newToml = `${toml.replace(/\s*$/, "")}\n${overridesBlock}\n`;
  }

  fs.writeFileSync(tomlPath, newToml);
  console.log(
    `==> Synced ${overrides.length} parameter(s) from ${path.relative(ROOT, envPath)} into [${tomlSection}] in ${path.relative(ROOT, tomlPath)}`
  );
}

main();
