# DynamoDB Tables

This API uses **5 DynamoDB tables** across all Lambda services.

| Table | Name | Env var | Services |
|---|---|---|---|
| Organisation (main) | `sale-sync-organisation` | `ORGANISATION_TABLE_NAME` (from `OrganisationInfraStack`, global default via `Globals`) | Organisation, Template, Plan |
| Auth | `sale-sync-auth` | `AUTH_TABLE_NAME` (from `AuthInfraStack`, Auth only) | Auth |
| Media | `sale-sync-media` | `MEDIA_TABLE_NAME` (from `MediaInfraStack`) | Media, media-s3-event |
| Blocks | `sale-sync-block` | `BLOCK_TABLE_NAME` (unmanaged parameter — see [Known gaps](../infra/README.md#known-gaps-intentionally-not-auto-fixed)) | Blocks |
| Properties | `sale-sync-properties` | `PROPERTY_TABLE_NAME` (from `PropertiesInfraStack`) | Properties |

Every table's env var name follows the same `<DOMAIN>_TABLE_NAME` convention — no function reads a bare `TABLE_NAME` anymore.

---

## `sale-sync-organisation`

Provisioned by the `OrganisationInfraStack` nested stack (`infra/organisation.yaml`), including its `inverted-index` GSI. The table name is injected via the `ORGANISATION_TABLE_NAME` environment variable (set globally for all Lambdas via `Globals.Function.Environment.Variables`).

The primary single-table design shared across multiple services. All organisation, user, template, and plan data lives here.

See the individual access-pattern docs for the key schema:

- [Organisation](./access-patterns/organisation.md)
- [Template](./access-patterns/template.md)
- [Plan](./access-patterns/plan.md)
- [Blocks](./access-patterns/blocks.md)

---

## `sale-sync-auth`

Provisioned by the `AuthInfraStack` nested stack (`infra/auth.yaml`). The table name is injected via the `AUTH_TABLE_NAME` environment variable on the Auth Lambda.

Stores auth session data managed by the Auth Lambda (`auth/services/auth.service.ts`).

---

## Media table

Provisioned by the `MediaInfraStack` nested stack (`infra/media.yaml`). The table name is injected at deploy time via the `MEDIA_TABLE_NAME` environment variable on the Media Lambda.

Used by `media/services/media.service.ts` and `media/services/folder.service.ts`.

See [Media access patterns](./access-patterns/media.md) for the key schema.

---

## Blocks table

The table name is injected at deploy time via the `BLOCK_TABLE_NAME` environment variable (passed as a SAM parameter).

Used by `blocks/default/blocks.service.ts`.

See [Blocks access patterns](./access-patterns/blocks.md) for the key schema.

---

## Properties table

Provisioned by the `PropertiesInfraStack` nested stack (`infra/properties.yaml`), including its 3 GSIs (`property-area-index`, `property-type-index`, `property-region-index`). The table name is injected at deploy time via the `PROPERTY_TABLE_NAME` environment variable on the Properties Lambda.

The Properties Lambda also gets a scoped `DynamoDBReadPolicy` on `sale-sync-organisation` (env var `ORGANISATION_TABLE_NAME`), used only to check an org's `business_category` before allowing property CRUD.

Used by `properties/services/property.service.ts`.

See [Property access patterns](./access-patterns/properties.md) for the key schema.
