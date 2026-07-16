#!/usr/bin/env bash
# One-time fix: the 9 Chiang Mai properties created by
# import-wello-chiang-mai-properties.sh were all written with every unit's
# tag defaulted to "buy", because the running sam local bundle had a stale
# UnitInputSchema (missing tag/soldPrice/rentPrice) at the time — Zod
# silently stripped the field before it ever reached normalizeUnit. That's
# now fixed (see api/Makefile's `deps` vs `deps.properties`/`deps.all`
# targets — `shared.pack` was calling the weaker one). This script re-sends
# each property's full `units` array (read straight from the source-of-truth
# payload/properties/*.json, which already has the correct tag/soldPrice/
# rentPrice per unit) via PATCH /properties, now that the schema fix is live.
#
# Requires `make start` (sam local on :8080, pointed at staging tables) running.
#
# Usage:
#   ./scripts/fix-wello-chiang-mai-property-tags.sh

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
    slug="$(python3 -c "import json; print(json.load(open('$PAYLOAD_DIR/$f'))['slug'])")"
    echo "→ $f (slug=$slug)"

    # Look up the property_uuid the earlier (buggy) POST created for this slug.
    uuid="$(curl -s -X GET "${API_URL}?slug=${slug}" -H "Cookie: ${COOKIE}" \
        | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('uuid',''))")"

    if [[ -z "$uuid" ]]; then
        echo "  ! could not resolve uuid for slug=$slug — skipping"
        continue
    fi

    # Re-send just property_uuid + units (with correct tag/soldPrice/rentPrice)
    # from the source-of-truth payload file — PATCH only touches fields present.
    python3 -c "
import json
payload = json.load(open('$PAYLOAD_DIR/$f'))
print(json.dumps({'property_uuid': '$uuid', 'units': payload['units']}))
" > /tmp/patch-$$.json

    curl -s -X PATCH "$API_URL" \
        -H "Content-Type: application/json" \
        -H "Cookie: ${COOKIE}" \
        --data-binary "@/tmp/patch-$$.json" \
        | python3 -c "
import json,sys
d = json.load(sys.stdin)
tags = sorted(set(u.get('tag') for u in d.get('units', [])))
print(f'  fixed: tags={tags}')
"
    rm -f /tmp/patch-$$.json
done

echo
echo "✓ Done — refresh the wello map view (hard refresh) to see corrected badges."
