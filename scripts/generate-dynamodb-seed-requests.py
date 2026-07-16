#!/usr/bin/env python3
"""Generates aws dynamodb transact-write-items request files (one per
property) that write a Property + its slug-lookup item directly into
the staging Properties table, bypassing the API entirely.

Mirrors PropertyService.createProperty/normalizeUnit in
api/properties/services/property.service.ts exactly (same PK/SK/GSI
key builders, same per-unit defaults) so the resulting item is
indistinguishable from one the real API would have written.

This script only reads local JSON fixtures and writes local JSON
request files — it makes no AWS calls itself. Review the generated
files under scripts/dynamodb-seed/*.transact.json, then run
scripts/import-wello-chiang-mai-properties-dynamodb.sh yourself to
actually execute the aws dynamodb commands.

Usage:
    python3 scripts/generate-dynamodb-seed-requests.py
"""
import json
import uuid
import datetime
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PAYLOAD_DIR = SCRIPT_DIR / ".." / "payload" / "properties"
OUT_DIR = SCRIPT_DIR / "dynamodb-seed"

TABLE = "staging-sale-sync-properties"
ORG_UUID = "563453ec-9dac-45f3-969e-e2a4ae4fff62"  # wello

FILES = [
    "chiang-mai-riverside-villas-buy.json",
    "chiang-mai-nimman-garden-condo-buy.json",
    "chiang-mai-doi-suthep-estate-buy.json",
    "chiang-mai-old-city-loft-rent.json",
    "chiang-mai-hang-dong-pool-villa-rent.json",
    "chiang-mai-santitham-apartments-rent.json",
    "chiang-mai-mae-rim-teak-house-sold.json",
    "chiang-mai-chang-phuak-townhome-sold.json",
    "chiang-mai-san-kamphaeng-land-sold.json",
]

UNIT_FIELDS_DEFAULT_NULL = [
    "image", "sellPrice", "sellDiscountPrice", "sellMaxPrice", "soldPrice",
    "rentPrice", "beds", "baths", "hall", "kitchen", "pantry", "car",
    "unitSize", "landSize", "size", "condition", "furnishing",
]


def pk(org_uuid):
    return f"ORG#{org_uuid}#PROPERTY"


def sk(property_uuid):
    return f"PROPERTY#{property_uuid}"


def gsi1pk(org_uuid, country):
    return f"ORG#{org_uuid}#PROPERTY#COUNTRY#{country}"


def gsi1sk(area_key, property_uuid):
    return f"AREA#{area_key}#PROPERTY#{property_uuid}"


def gsi2pk(org_uuid, prop_type):
    return f"ORG#{org_uuid}#PROPERTY#TYPE#{prop_type}"


def gsi3pk(org_uuid, country, region):
    return f"ORG#{org_uuid}#PROPERTY#COUNTRY#{country}#REGION#{region}"


def slug_pk(org_uuid, slug):
    return f"ORG#{org_uuid}#PROPERTY#SLUG#{slug}"


def normalize_unit(unit):
    normalized = {"uuid": unit.get("uuid") or str(uuid.uuid4()), "title": unit["title"], "tag": unit.get("tag") or "buy"}
    for field in UNIT_FIELDS_DEFAULT_NULL:
        normalized[field] = unit.get(field, None)
    return normalized


def build_property(payload):
    # Match JS's Date.toISOString() millisecond precision (Python's isoformat()
    # defaults to microseconds) so the record is indistinguishable from one the
    # real API would have written.
    now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return {
        "uuid": str(uuid.uuid4()),
        "title": payload["title"],
        "typeLabel": payload["typeLabel"],
        "postedLabel": payload["postedLabel"],
        "lat": payload["lat"],
        "lng": payload["lng"],
        "location": payload["location"],
        "country": payload["country"],
        "region": payload.get("region"),
        "area_key": payload["area_key"],
        "type": payload["type"],
        "scope": payload.get("scope", "staff"),
        "slug": payload["slug"],
        "sellPrice": payload.get("sellPrice"),
        "sellDiscountPrice": payload.get("sellDiscountPrice"),
        "sellMaxPrice": payload.get("sellMaxPrice"),
        "code": payload.get("code"),
        "isLeasehold": payload.get("isLeasehold", False),
        "brochure": payload.get("brochure"),
        "image": payload.get("image"),
        "images": payload.get("images", []),
        "description": payload.get("description"),
        "payment": payload.get("payment"),
        "units": [normalize_unit(u) for u in payload.get("units", [])],
        "created_at": now,
        "updated_at": now,
    }


def gsi_attributes(org_uuid, prop):
    attrs = {
        "GSI1PK": {"S": gsi1pk(org_uuid, prop["country"])},
        "GSI1SK": {"S": gsi1sk(prop["area_key"], prop["uuid"])},
        "GSI2PK": {"S": gsi2pk(org_uuid, prop["type"])},
    }
    if prop.get("region"):
        attrs["GSI3PK"] = {"S": gsi3pk(org_uuid, prop["country"], prop["region"])}
        attrs["GSI3SK"] = {"S": gsi1sk(prop["area_key"], prop["uuid"])}
    return attrs


def build_transact_request(org_uuid, prop, slug):
    item = {
        "PK": {"S": pk(org_uuid)},
        "SK": {"S": sk(prop["uuid"])},
        **gsi_attributes(org_uuid, prop),
        "data": {"S": json.dumps(prop)},
    }
    slug_item = {
        "PK": {"S": slug_pk(org_uuid, slug)},
        "SK": {"S": "META"},
        "data": {"S": json.dumps({"property_uuid": prop["uuid"]})},
    }
    return {
        "TransactItems": [
            {"Put": {"TableName": TABLE, "Item": item}},
            {
                "Put": {
                    "TableName": TABLE,
                    "Item": slug_item,
                    "ConditionExpression": "attribute_not_exists(PK) AND attribute_not_exists(SK)",
                }
            },
        ]
    }


def main():
    OUT_DIR.mkdir(exist_ok=True)
    manifest = []
    for filename in FILES:
        payload = json.loads((PAYLOAD_DIR / filename).read_text())
        prop = build_property(payload)
        request = build_transact_request(ORG_UUID, prop, payload["slug"])
        out_name = filename.replace(".json", ".transact.json")
        (OUT_DIR / out_name).write_text(json.dumps(request, indent=2) + "\n")
        manifest.append({"file": out_name, "title": prop["title"], "slug": prop["slug"], "uuid": prop["uuid"]})
        print(f"generated {out_name}  (uuid={prop['uuid']}, slug={prop['slug']})")

    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"\n{len(FILES)} request files written to {OUT_DIR}")


if __name__ == "__main__":
    main()
