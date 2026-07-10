# DynamoDB Tables

This API uses **5 DynamoDB tables** across all Lambda services.

| Table | Name | Env var | Services |
|---|---|---|---|
| Organisation (main) | `sale-sync-organisation` | `ORGANISATION_TABLE_NAME` (from the `ss/infra` stack, global default via `Globals`) | Organisation, Template, Plan |
| Auth | `sale-sync-auth` | `AUTH_TABLE_NAME` (from the `ss/infra` stack, Auth only) | Auth |
| Media | `sale-sync-media` | `MEDIA_TABLE_NAME` (from the `ss/infra` stack) | Media, media-s3-event |
| Blocks | `sale-sync-block` | `BLOCK_TABLE_NAME` (unmanaged parameter — see [Known gaps](../infra/README.md#known-gaps-intentionally-not-auto-fixed)) | Blocks |
| Properties | `sale-sync-properties` | `PROPERTY_TABLE_NAME` (from the `ss/infra` stack) | Properties |

Every table's env var name follows the same `<DOMAIN>_TABLE_NAME` convention — no function reads a bare `TABLE_NAME` anymore.

---

## Key Attribute Naming Convention

**Partition key and sort key attributes are always named `PK` and `SK` (uppercase) — in both the CFN table definition (`infra/*.yaml` `AttributeDefinitions`/`KeySchema`) and every service's `Item`/`Key`/`KeyConditionExpression`/`ConditionExpression`.** GSI key attributes follow the same rule with their own name (e.g. `GSI1PK`, `GSI1SK`) — pick a name, then use that exact casing everywhere.

DynamoDB attribute names are case-sensitive. A mismatch between infra and code doesn't fail at build time or `sam validate` — it only surfaces at runtime as `ValidationException: Missing the key pk in the item` (or a query silently returning zero results), which is exactly what happened once: see [`docs/logs/2026-07-08-pk-sk-casing-mismatch.md`](../logs/2026-07-08-pk-sk-casing-mismatch.md). `organisation`, `auth`, and `media` were fixed there.

**Exception — `blocks`:** its table is not provisioned in this repo's CloudFormation at all (see [Known gaps](../infra/README.md#known-gaps-intentionally-not-auto-fixed)); the code still uses lowercase `pk`/`sk`. Don't assume the uppercase rule applies there without first confirming the real external table's schema (`aws dynamodb describe-table`).

**Before adding a new table or a new service against an existing one:** confirm the table's actual `KeySchema` matches what the code writes — don't copy a key-name convention from another service without checking the specific table it targets.

---

## `sale-sync-organisation`

Provisioned by the standalone `ss/infra` stack (`ss/infra/template.yaml`), including its `inverted-index` GSI. The table name is injected via the `ORGANISATION_TABLE_NAME` environment variable (set globally for all Lambdas via `Globals.Function.Environment.Variables`).

The primary single-table design shared across multiple services. All organisation, user, template, and plan data lives here.

See the individual access-pattern docs for the key schema:

- [Organisation](./access-patterns/organisation.md)
- [Template](./access-patterns/template.md)
- [Plan](./access-patterns/plan.md)
- [Blocks](./access-patterns/blocks.md)

---

## `sale-sync-auth`

Provisioned by the standalone `ss/infra` stack (`ss/infra/template.yaml`). The table name is injected via the `AUTH_TABLE_NAME` environment variable on the Auth Lambda.

Stores auth session data managed by the Auth Lambda (`auth/services/auth.service.ts`).

---

## Media table

Provisioned by the standalone `ss/infra` stack (`ss/infra/template.yaml`). The table name is injected at deploy time via the `MEDIA_TABLE_NAME` environment variable on the Media Lambda.

Used by `media/services/media.service.ts` and `media/services/folder.service.ts`.

See [Media access patterns](./access-patterns/media.md) for the key schema.

---

## Blocks table

The table name is injected at deploy time via the `BLOCK_TABLE_NAME` environment variable (passed as a SAM parameter).

Used by `blocks/default/blocks.service.ts`.

See [Blocks access patterns](./access-patterns/blocks.md) for the key schema.

---

## Properties table

Provisioned by the standalone `ss/infra` stack (`ss/infra/template.yaml`), including its 3 GSIs (`property-area-index`, `property-type-index`, `property-region-index`). The table name is injected at deploy time via the `PROPERTY_TABLE_NAME` environment variable on the Properties Lambda.

The Properties Lambda also gets a scoped `DynamoDBReadPolicy` on `sale-sync-organisation` (env var `ORGANISATION_TABLE_NAME`), used only to check an org's `business_category` before allowing property CRUD.

Used by `properties/services/property.service.ts`.

See [Property access patterns](./access-patterns/properties.md) for the key schema.
