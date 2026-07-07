# DynamoDB Tables

This API uses **5 DynamoDB tables** across all Lambda services.

| Table | Name | Services |
|---|---|---|
| Organisation (main) | `sale-sync-organisation` | Organisation, Template, Plan, CRM (customer lookups) |
| Auth | `sales-sync-auth` | Auth |
| CRM | `sales-sync-crm` | CRM (contacts, forms) |
| Media | env var `TABLE_NAME` (from `MediaInfraStack`) | Media, media-s3-event |
| Blocks | env var `BLOCK_TABLE_NAME` | Blocks |

---

## `sale-sync-organisation`

The primary single-table design shared across multiple services. All organisation, user, template, plan, and theme data lives here.

See the individual access-pattern docs for the key schema:

- [Organisation](./access-patterns/organisation.md)
- [Template](./access-patterns/template.md)
- [Plan](./access-patterns/plan.md)
- [Blocks](./access-patterns/blocks.md)

---

## `sales-sync-auth`

Stores auth session data managed by the Auth Lambda. Hardcoded table name in `auth/services/auth.service.ts`.

---

## `sales-sync-crm`

Stores CRM contacts and form submissions. Used by `crm/contact/contact.service.ts` and `crm/form/form.service.ts`.

See [CRM access patterns](./access-patterns/media.md) for the key schema.

---

## Media table

Provisioned by the `MediaInfraStack` nested stack (`templates/media.yaml`). The table name is injected at deploy time via the `TABLE_NAME` environment variable on the Media Lambda.

Used by `media/services/media.service.ts` and `media/services/folder.service.ts`.

See [Media access patterns](./access-patterns/media.md) for the key schema.

---

## Blocks table

The table name is injected at deploy time via the `BLOCK_TABLE_NAME` environment variable (passed as a SAM parameter).

Used by `blocks/default/blocks.service.ts`.

See [Blocks access patterns](./access-patterns/blocks.md) for the key schema.
