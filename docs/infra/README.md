# Infrastructure

> **Migrated.** Shared infra (DynamoDB tables, S3 buckets, the media
> S3-event Lambda) used to live in `infra/` as CFN nested stacks owned by
> this repo's `template.yaml`. It's now a standalone stack in the sibling
> `ss/infra` repo, so it can be shared across multiple independent API
> stacks instead of being owned by this one. See
> [`ss/infra/docs/runbook.md`](../../../infra/docs/runbook.md) for the
> migration procedure and current source of truth, and
> [`ss/infra/docs/migration.md`](../../../infra/docs/migration.md) for the
> "why". The migration is fully verified in both staging and prod, and
> `infra/` has been deleted from this repo — `ss/infra/template.yaml` is now
> the only copy of these resource definitions. Don't recreate `infra/` here.

See [`docs/infra/domains.md`](./domains.md) for how this maps to actual
environments (local/staging/production) and API domains.

## How `template.yaml` gets infra values now

Every table/bucket that used to come from a nested stack's `Outputs` is now
a plain CloudFormation `Parameter` on the root template
(`AuthTableName`, `OrganisationTableName`, `MediaTableName`,
`MediaBucketName`, `PropertyTableName`), wired into Lambda
`Environment.Variables` and `Policies` with `!Ref` instead of
`!GetAtt <Stack>.Outputs.<Name>`. The values are the same deterministic
`${ResourcePrefix}sale-sync-<name>` names as before — they don't change,
only who's managing the underlying resource does.

Parameter values are supplied the same way Cognito's `ClientId`/
`ClientSecret`/etc. always have been: `env.staging.json`/`env.prod.json` →
`scripts/sync-samconfig.js` → `samconfig.toml`'s `parameter_overrides` →
`sam deploy`.

## The `ResourcePrefix` parameter

Still used the same way, just now by `ss/infra`'s template instead of
`infra/*.yaml`:
- Production deploys leave `ResourcePrefix` empty → `sale-sync-media`,
  `sale-sync-auth`, `sale-sync-organisation`, etc.
- Staging overrides it to `staging-` → `staging-sale-sync-media`, etc.

## What moved where

| Resource | Consumed by (this repo) | Now managed by |
|---|---|---|
| `AuthTable` | `AuthFunction` via `AUTH_TABLE_NAME` | `ss/infra` |
| `OrganisationTable` | Every Lambda by default, via `Globals.Function.Environment.Variables.ORGANISATION_TABLE_NAME` — org/user/template/plan single-table design, see [`docs/dynamodb/access-patterns/organisation.md`](../dynamodb/access-patterns/organisation.md) | `ss/infra` |
| `MediaBucket`/`MediaBucketLogs`/`MediaTable` | `MediaFunction`/`MediaDefaultFunction` via `MEDIA_TABLE_NAME`/`MEDIA_BUCKET_NAME` | `ss/infra` |
| `MediaS3EventFunction`/`MediaS3EventPermission` | Not consumed by this repo — standalone, triggered directly by S3 on `MediaBucket`. See [`docs/dynamodb/access-patterns/media.md`](../dynamodb/access-patterns/media.md#key-design-notes) for what it does. | `ss/infra` |
| `PropertyTable` | `PropertiesFunction`/`PropertiesDefaultFunction` via `PROPERTY_TABLE_NAME` | `ss/infra` |
| `ImageBucket`/`ImageBucketLogs` | **Not currently consumed by any Lambda** — provisioned ahead of the org/user image-upload feature (see "Known gaps" below) | `ss/infra` |

## IAM — least privilege

Every Lambda's `Policies` block is still scoped to only the specific
table/bucket it actually uses — the mechanism changed from `!GetAtt
<Stack>.Outputs.<Name>` to `!Ref <Name>Parameter`, but CloudFormation
builds the exact same scoped resource ARN either way (SAM's policy
templates just need the table/bucket *name*, not a same-stack resource).
Never a bare AWS-managed full-access policy.

| Function | Policies |
|---|---|
| `AuthFunction` | `DynamoDBCrudPolicy` on `AuthTableName` |
| `OrganisationFunction`/`OrganisationDefaultFunction` | `DynamoDBCrudPolicy` on `OrganisationTableName` |
| `TemplateCatalogueFunction`/`TemplateCatalogueDefaultFunction` | `DynamoDBCrudPolicy` on `OrganisationTableName` (Template data lives in the org table) |
| `PlanFunction`/`PlanDefaultFunction` | `DynamoDBCrudPolicy` on `OrganisationTableName` (Plan data lives in the org table) |
| `MediaFunction`/`MediaDefaultFunction` | `DynamoDBCrudPolicy` on `MediaTableName` + `S3CrudPolicy` on `MediaBucketName` (the media *library* bucket — not Images) |
| `BlocksFunction`/`BlocksDefaultFunction` | `DynamoDBCrudPolicy` on the (unmanaged) `BlockTableName` parameter |
| `PropertiesFunction`/`PropertiesDefaultFunction` | `DynamoDBCrudPolicy` on `PropertyTableName` + `DynamoDBReadPolicy` (read-only) on `OrganisationTableName` |
| `MediaS3EventFunction` (now in `ss/infra`) | `DynamoDBCrudPolicy` on `MediaTable` + a custom `Statement` for `dynamodb:TransactWriteItems` on `MediaTable.Arn` + a custom `Statement` for `s3:GetObject`/`s3:HeadObject` on a predictable `arn:aws:s3:::${ResourcePrefix}sale-sync-media/*` string |

## Known gaps (intentionally not auto-fixed)

- **`ImageBucket`/`ImageBucketLogs` have no consuming Lambda yet.** Real,
  intentional infra for a feature that isn't built — an S3-event-triggered
  Lambda (mirroring `MediaS3EventFunction`'s pattern) that would update an
  org's/user's `Image` attribute on upload. Not a naming or wiring bug —
  just not implemented yet. Now provisioned in `ss/infra` instead of this
  repo.
- **`BlockTableName` (Blocks) is still an unmanaged, externally-referenced
  parameter.** There's no CFN-managed table backing it in either repo —
  it needs to already exist by that name, or a real definition needs to be
  added to `ss/infra/template.yaml`, mirroring the other tables there. Not
  done yet — same kind of explicit go-ahead the original table migrations
  got. Its code (`blocks/default/blocks.service.ts`) also still uses
  lowercase `pk`/`sk`, unverified against the real external table — see the
  `PK`/`SK` convention note in
  [`docs/dynamodb/tables.md`](../dynamodb/tables.md#key-attribute-naming-convention)
  before touching it.

## Auditing deployed resources

`scripts/check-resources.sh` (wrapped by `make check.staging` /
`make check.prod` / `make check.both`) lists, per environment, the
CloudFormation stack statuses, DynamoDB tables, S3 buckets, and Lambda
functions matching that environment's naming prefix (`staging-sale-sync-*`
/ `sale-sync-*`) — all read-only (`list-stacks`/`list-tables`/
`list-buckets`/`list-functions`). `ss/infra` has its own copy
(`ss/infra/scripts/check-resources.sh`) adapted to also match the new
`*-infra` stack name.

Run this **before** a deploy if a previous attempt failed partway through,
and **after** a deploy to confirm what actually exists — see
[`docs/logs/2026-07-08-media-infra-stack-deploy-failure.md`](../logs/2026-07-08-media-infra-stack-deploy-failure.md)
for the incident that motivated this script and the same class of risk
(orphaned `DeletionPolicy: Retain` resources from a partial deploy) that
applies to the `ss/infra` import procedure too.

```bash
make check.staging   # or: ./scripts/check-resources.sh staging
make check.prod
make check.both
```

## Adding a new shared table/bucket

Now happens in `ss/infra/template.yaml`, not this repo:
1. Add the resource there following the existing pattern: `DeletionPolicy:
   Retain` / `UpdateReplacePolicy: Retain`, `!Sub '${ResourcePrefix}sale-sync-<name>'`
   naming, and an `Outputs` entry.
2. Add a matching `Parameter` to *this* repo's `template.yaml`, and wire the
   Lambda(s) that need it via `Environment.Variables`/`Policies` using
   `!Ref` — never a bare full-access policy.
3. Add the value to `env.staging.json`/`env.prod.json` in both repos and to
   the `PARAM_KEY_MAP` in `scripts/sync-samconfig.js` (this repo) if it's a
   new key.
4. If it's a table other services should be able to discover, document its
   key schema under [`docs/dynamodb/`](../dynamodb/).
