#!/usr/bin/env node
// Compiles env.<name>.json ("Parameters" block) into samconfig.toml's
// parameter_overrides, since `sam deploy` ignores --env-vars files and only
// reads CloudFormation parameters from samconfig.toml.
//
// Usage: node scripts/sync-samconfig.js [envName] [tomlSection]
//   envName     defaults to "prod"      -> reads env.<envName>.json
//   tomlSection defaults to "default.deploy.parameters"

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const envName = process.argv[2] || "prod";
const tomlSection = process.argv[3] || "default.deploy.parameters";

const envPath = path.join(ROOT, `env.${envName}.json`);
const tomlPath = path.join(ROOT, "samconfig.toml");

// Keep in sync with the `Parameters:` block in template.yaml
const PARAM_KEY_MAP = {
  TABLE_NAME: "TableName",
  MEDIA_TABLE_NAME: "MediaTableName",
  BLOCK_TABLE_NAME: "BlockTableName",
  S3_BUCKET_NAME: "S3BucketName",
  COGNITO_URL: "CognitoUrl",
  CLIENT_ID: "ClientId",
  CLIENT_SECRET: "ClientSecret",
  COGNITO_CALLBACK_URL: "CognitoCallbackUrl",
};

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
