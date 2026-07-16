#!/usr/bin/env bash
# Imports the 9 Chiang Mai buy/rent/sold property fixtures
# (payload/properties/chiang-mai-*-{buy,rent,sold}.json) into the wello org
# via POST /properties against a locally-running `sam local start-api`
# instance pointed at the staging tables (`make start`, see api/Makefile —
# `sam local start-api --port 8080 --env-vars env.staging.json`). Written for
# the unit-status-tag backlog (see
# backlogs/properties/children/unit-status-tag) to seed staging data that
# exercises all three Unit.tag values.
#
# Requires `make start` running in another terminal first (api/).
#
# Auth: hitting :8080 directly (not through the api.salesync.local nginx
# proxy) lets Authentication/Identifier be dummy values — sam local doesn't
# verify their signature, it only decodes Organisation (via jwt-decode, also
# unverified) to resolve org scoping. Organisation therefore still needs to
# be a real, correctly-shaped JWT for the wello org; defaults to the token
# already committed in theme-maker/wello/.env.staging's ORGANISATION_TOKEN.
#
# Usage:
#   ./scripts/import-wello-chiang-mai-properties.sh
#
# Overrides:
#   API_URL=http://localhost:8080/properties ./scripts/import-wello-chiang-mai-properties.sh
#   ORG_TOKEN='eyJ...' ./scripts/import-wello-chiang-mai-properties.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAYLOAD_DIR="$SCRIPT_DIR/../payload/properties"
WELLO_ENV="$SCRIPT_DIR/../../theme-maker/wello/.env.staging"

API_URL="${API_URL:-http://localhost:8080/properties}"

ORG_TOKEN="${ORG_TOKEN:-}"
if [[ -z "$ORG_TOKEN" && -f "$WELLO_ENV" ]]; then
    ORG_TOKEN="$(grep '^ORGANISATION_TOKEN=' "$WELLO_ENV" | cut -d= -f2-)"
fi
: "${ORG_TOKEN:?Could not find ORGANISATION_TOKEN in $WELLO_ENV — pass ORG_TOKEN=... explicitly}"

COOKIE="Authentication=test; Identifier=test; Organisation=${ORG_TOKEN}"

FILES=(
    chiang-mai-riverside-villas-buy.json
    chiang-mai-nimman-garden-condo-buy.json
    chiang-mai-doi-suthep-estate-buy.json
    chiang-mai-old-city-loft-rent.json
    chiang-mai-hang-dong-pool-villa-rent.json
    chiang-mai-santitham-apartments-rent.json
    chiang-mai-mae-rim-teak-house-sold.json
    chiang-mai-chang-phuak-townhome-sold.json
    chiang-mai-san-kamphaeng-land-sold.json
)

for f in "${FILES[@]}"; do
    echo "→ $f"
    curl -s -X POST "$API_URL" \
        -H "Content-Type: application/json" \
        -H "Cookie: ${COOKIE}" \
        --data-binary "@$PAYLOAD_DIR/$f" \
        | python3 -m json.tool
    echo
done

echo "✓ Done — check each response for scope/slug/tag matching what was intended."
