#!/usr/bin/env node
// One-off bulk import for backlogs/client-data-migration/children/properties-migration-wix-to-json:
// reads a JSON array of property records (converted from a client's exported Wix CSV — see that
// backlog's tasks.md) and creates each one via the real POST /properties endpoint, so every create
// goes through PropertyService.createProperty() exactly as if a staff user clicked "add property"
// — validation, real-estate-category gate, key derivation, and slug-uniqueness all handled
// server-side, nothing duplicated here.
//
// Auth: POST /properties is guarded by isAuthorize()+getOrganisation() (api/apps/api/properties/
// default/default.controller.ts), which read three cookies — Authentication, Identifier,
// Organisation — off the request. There's no practical way to script the login that produces them:
// Authentication/Identifier come from a full Cognito Hosted-UI OAuth flow, and Organisation is
// minted by a separate authenticated call (platform/apps/web-app/src/routes/api/organisation/set.ts)
// that signs a JWT with ORGANISATION_SECRET — a secret this script deliberately never touches.
//
// Instead, this script reuses a real, already-authenticated browser session:
//   1. Log into the platform web-app as a staff user of the home-thailand-estates organisation
//      (in whichever environment you're targeting — staging first).
//   2. Make sure you're switched into that organisation (so the Organisation cookie is set).
//   3. Open devtools -> Application -> Cookies (or the Network tab on any authenticated request)
//      and copy the Authentication, Identifier, and Organisation cookie values.
//   4. Export them as one Cookie-header string (kept out of shell history / `ps` output, unlike a
//      --cookie flag):
//        export SS_MIGRATION_COOKIE="Authentication=<value>; Identifier=<value>; Organisation=<value>"
//      (--cookie "<cookie-header>" also works if you'd rather pass it as a flag.)
//
// SAFETY: dry-run by default — validates every record locally (against the real CreatePropertySchema)
// and prints what would be POSTed, but sends nothing. Pass --execute to actually POST. Always run
// against staging first. A 401/403/404 on the very first request aborts the whole run (means the
// cookie/org context is wrong) rather than burning through the rest of the file.
//
// Usage:
//   export SS_MIGRATION_COOKIE="Authentication=<value>; Identifier=<value>; Organisation=<value>"
//   node scripts/migrate-properties-via-api.js --api-url <base-url> \
//     --file <path/to/properties.json> [--execute] [--delay-ms <n>]
//
// --api-url is the API's base URL for the environment you're targeting (same value as
// platform/apps/web-app's VITE_PUBLIC_API_URL there — not read from any .env file by this script).
//
// Input file shape: a JSON array of objects matching CreatePropertySchema, e.g.:
//   [{ "title": "...", "lat": 13.7, "lng": 100.5, "location": "...", "type": "condo",
//      "slug": "some-condo", "units": [{ "title": "Unit 1" }], ... }, ...]

const fs = require('fs');
const { CreatePropertySchema } = require('@sale-sync/shared');

const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');

function flagValue(name, fallback) {
    const i = args.indexOf(name);
    return i !== -1 ? args[i + 1] : fallback;
}

const API_URL = flagValue('--api-url', null);
const COOKIE = flagValue('--cookie', process.env.SS_MIGRATION_COOKIE || null);
const FILE = flagValue('--file', null);
const DELAY_MS = Number(flagValue('--delay-ms', '250'));

if (!API_URL || !COOKIE || !FILE) {
    console.error('Usage: export SS_MIGRATION_COOKIE="<cookie-header>"; node scripts/migrate-properties-via-api.js --api-url <base-url> --file <path/to/properties.json> [--execute] [--delay-ms <n>] [--cookie "<cookie-header>"]');
    process.exit(1);
}

const ENDPOINT = `${API_URL.replace(/\/$/, '')}/properties`;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
    console.log(`[migrate-properties-via-api] endpoint=${ENDPOINT} file=${FILE} mode=${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}`);

    const raw = fs.readFileSync(FILE, 'utf8');
    const records = JSON.parse(raw);
    if (!Array.isArray(records)) {
        throw new Error(`${FILE} must contain a JSON array of property records`);
    }

    let validationFailed = 0;
    let created = 0;
    let alreadyExists = 0;
    let writeErrors = 0;

    for (let i = 0; i < records.length; i++) {
        const label = `[${i + 1}/${records.length}]`;
        const parsed = CreatePropertySchema.safeParse(records[i]);

        if (!parsed.success) {
            validationFailed++;
            const title = records[i]?.title ?? records[i]?.slug ?? '(untitled)';
            console.log(`  ✗ ${label} "${title}" — schema validation failed:`);
            for (const issue of parsed.error.issues) {
                console.log(`      ${issue.path.join('.')}: ${issue.message}`);
            }
            continue;
        }

        const input = parsed.data;
        console.log(`  + ${label} slug="${input.slug}" title="${input.title}"`);

        if (!EXECUTE) {
            created++;
            continue;
        }

        let res;
        try {
            res = await fetch(ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Cookie: COOKIE },
                body: JSON.stringify(input),
            });
        } catch (error) {
            writeErrors++;
            console.error(`      request failed: ${error.message}`);
            continue;
        }

        if (res.status === 401 || res.status === 403 || res.status === 404) {
            const body = await res.text().catch(() => '');
            console.error(`      ${res.status} on record ${i + 1} — cookie/org context looks wrong, aborting rest of run: ${body}`);
            process.exitCode = 1;
            break;
        }

        if (res.status === 201) {
            created++;
        } else if (res.status === 409) {
            alreadyExists++;
            console.log(`      slug="${input.slug}" already exists for this org, skipping`);
        } else if (res.status === 400) {
            validationFailed++;
            const body = await res.json().catch(() => ({}));
            console.log(`      server rejected — ${body.message ?? res.statusText}`);
        } else {
            writeErrors++;
            const body = await res.text().catch(() => '');
            console.error(`      unexpected ${res.status}: ${body}`);
        }

        if (DELAY_MS > 0) await sleep(DELAY_MS);
    }

    console.log(
        `[migrate-properties-via-api] total=${records.length} ${EXECUTE ? 'created' : 'would_create'}=${created} already_exists=${alreadyExists} validation_failed=${validationFailed} write_errors=${writeErrors} ${
            EXECUTE ? '(written)' : '(dry-run only — pass --execute to send)'
        }`,
    );

    if (writeErrors > 0) process.exitCode = 1;
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
