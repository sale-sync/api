# Infrastructure (`infra/`)

`infra/` holds nested CloudFormation stacks, each deployed from the root `template.yaml` as an `AWS::Serverless::Application` resource. Every stack provisions the DynamoDB tables and/or S3 buckets for one domain and exposes them via `Outputs`, which `template.yaml` reads with `!GetAtt <Stack>.Outputs.<Name>` to wire into Lambda environment variables. This keeps table/bucket names as real CloudFormation-managed resources instead of externally-referenced parameters that can drift from what's actually deployed.

See [`docs/infra/domains.md`](./domains.md) for how this maps to actual environments (local/staging/production) and API domains.

## Why nested stacks

SAM requires Lambda functions and `AWS::Serverless::Api` to live in the same template (`RestApiId` must reference a `AWS::Serverless::Api` in the same template), so all infra had to move into nested stacks rather than the root template. Every stateful resource in `infra/*.yaml` has `DeletionPolicy: Retain` and `UpdateReplacePolicy: Retain` — deleting the stack, or CloudFormation replacing a resource, orphans it instead of destroying data.

## The `ResourcePrefix` parameter

Every stack in `infra/` takes a `ResourcePrefix` parameter (`Type: String`, `Default: ''`), threaded down from the root `template.yaml` parameter of the same name. Resource names are built as `!Sub '${ResourcePrefix}sale-sync-<name>'`.

- Production deploys leave `ResourcePrefix` empty → `sale-sync-media`, `sale-sync-auth`, `sale-sync-organisation`, etc.
- A staging deploy overrides it to `staging-` (see `env.staging.json`'s `RESOURCE_PREFIX`) → `staging-sale-sync-media`, `staging-sale-sync-auth`, etc.

This lets the exact same templates be deployed as two separate stacks (prod + staging) without editing any YAML — only the parameter value changes, via `samconfig.toml` / `scripts/sync-samconfig.js`.

## Stacks

### `infra/auth.yaml` → `AuthInfraStack`

- `AuthTable` — DynamoDB, `pk`/`sk`, no GSI. OIDC nonce/state storage for the login flow.
- Consumed by: `AuthFunction` via `AUTH_TABLE_NAME` (function-level env var, scoped only to Auth).
- Outputs: `AuthTableName`, `AuthTableArn`.

### `infra/organisation.yaml` → `OrganisationInfraStack`

- `OrganisationTable` — DynamoDB, `pk`/`sk` + `inverted-index` GSI (HASH=`sk`, RANGE=`pk`). The shared single-table design for organisation/user/template/plan data — see [`docs/dynamodb/access-patterns/organisation.md`](../dynamodb/access-patterns/organisation.md).
- Consumed by: every Lambda by default, via `Globals.Function.Environment.Variables.ORGANISATION_TABLE_NAME`. Every table's env var follows the same `<DOMAIN>_TABLE_NAME` naming convention — `ORGANISATION_TABLE_NAME`, `AUTH_TABLE_NAME`, `MEDIA_TABLE_NAME`, `BLOCK_TABLE_NAME`, `PROPERTY_TABLE_NAME` — there's no bare `TABLE_NAME` left anywhere in the root template.
- Outputs: `OrganisationTableName`, `OrganisationTableArn`.

### `infra/media.yaml` → `MediaInfraStack`

- `MediaBucket` + `MediaBucketLogs` — S3, media file storage + access logs.
- `MediaTable` — DynamoDB, `pk`/`sk` + `folder-contents-index` + `path-index` GSIs. Media metadata (files, folders).
- `MediaS3EventFunction` + `MediaS3EventPermission` — a Lambda triggered by S3 `ObjectCreated` events under the `workspaces/` prefix, flips a media record from `pending` to `ready`. Uses a predictable Lambda ARN (via `FunctionName`) instead of SAM's `S3` event source, to avoid a circular dependency between the bucket and the function.
- Consumed by: `MediaFunction`/`MediaDefaultFunction` via `MEDIA_TABLE_NAME` and `MEDIA_BUCKET_NAME`.
- Outputs: `MediaBucketName`, `MediaBucketArn`, `MediaBucketLogsName`, `MediaTableName`, `MediaTableArn`, `MediaS3EventFunctionArn`.

### `infra/properties.yaml` → `PropertiesInfraStack`

- `PropertyTable` — DynamoDB, `PK`/`SK` + 3 GSIs (`property-area-index`, `property-type-index`, `property-region-index`). See [`docs/dynamodb/access-patterns/properties.md`](../dynamodb/access-patterns/properties.md).
- Consumed by: `PropertiesFunction`/`PropertiesDefaultFunction` via `PROPERTY_TABLE_NAME`.
- Outputs: `PropertyTableName`, `PropertyTableArn`.

### `infra/images.yaml` → `ImageInfraStack`

- `ImageBucket` + `ImageBucketLogs` — S3, image storage + access logs.
- **Distinct purpose from `MediaInfraStack`, not a duplicate:** Images stores images belonging to an organisation *or* an individual Cognito user (e.g. org logo, user avatar) — the `s3Key`/`s3Path` is recorded directly on the relevant DynamoDB item (e.g. the `Image` attribute on the org's `META#{org_uuid}` record — see the "Update / Add Image" access pattern in [`docs/dynamodb/access-patterns/organisation.md`](../dynamodb/access-patterns/organisation.md)), not in its own metadata table. Media, by contrast, is an organisation-wide media *library* (images/video/documents) with its own dedicated metadata table (`MediaTable`).
- **Not currently consumed by any Lambda.** The S3-event-triggered Lambda that's supposed to update the image attribute on upload is documented as "Reserved for standalone Lambda" in `organisation.md` but doesn't exist yet — so nothing in `template.yaml` references this stack's outputs today. The bucket is provisioned ahead of that Lambda being built, not dead/leftover infra.
- Outputs: `ImageBucketName`, `ImageBucketArn`, `ImageBucketLogsName`.

## IAM — least privilege

Every Lambda function's `Policies` block is scoped to only the specific table/bucket it actually uses, via SAM policy templates referencing the real CFN resource (`!GetAtt <Stack>.Outputs.<Name>`), never a bare AWS-managed full-access policy:

| Function | Policies |
|---|---|
| `AuthFunction` | `DynamoDBCrudPolicy` on `AuthInfraStack.Outputs.AuthTableName` |
| `OrganisationFunction`/`OrganisationDefaultFunction` | `DynamoDBCrudPolicy` on `OrganisationInfraStack.Outputs.OrganisationTableName` |
| `TemplateCatalogueFunction`/`TemplateCatalogueDefaultFunction` | `DynamoDBCrudPolicy` on `OrganisationInfraStack.Outputs.OrganisationTableName` (Template data lives in the org table) |
| `PlanFunction`/`PlanDefaultFunction` | `DynamoDBCrudPolicy` on `OrganisationInfraStack.Outputs.OrganisationTableName` (Plan data lives in the org table) |
| `MediaFunction`/`MediaDefaultFunction` | `DynamoDBCrudPolicy` on `MediaInfraStack.Outputs.MediaTableName` + `S3CrudPolicy` on `MediaInfraStack.Outputs.MediaBucketName` (the media *library* bucket — not Images) |
| `BlocksFunction`/`BlocksDefaultFunction` | `DynamoDBCrudPolicy` on the (unmanaged) `BlockTableName` parameter |
| `PropertiesFunction`/`PropertiesDefaultFunction` | `DynamoDBCrudPolicy` on `PropertiesInfraStack.Outputs.PropertyTableName` + `DynamoDBReadPolicy` (read-only) on `OrganisationInfraStack.Outputs.OrganisationTableName` |
| `MediaS3EventFunction` (inside `infra/media.yaml`) | `DynamoDBCrudPolicy` on `MediaTable` + a custom `Statement` for `s3:GetObject`/`s3:HeadObject` on `MediaBucket.Arn/*` |

No function has `AmazonDynamoDBFullAccess`, `AmazonS3FullAccess`, or any other blanket account-wide managed policy — each can only touch the table(s)/bucket it's actually wired to via `Environment.Variables`, nothing else in the account.

## Known gaps (intentionally not auto-fixed)

- **`ImageInfraStack` has no consuming Lambda yet.** It's real, intentional infra (see the Images section above) for a feature that isn't built — an S3-event-triggered Lambda (mirroring `MediaS3EventFunction`'s pattern) that would update an org's/user's `Image` attribute on upload. Not a naming or wiring bug — just not implemented yet.
- **`MediaS3EventFunction`'s `FunctionName` is a hardcoded literal** (`sales-sync-media-s3-event` in `infra/media.yaml`), not `ResourcePrefix`-aware. Deploying a second (staging) stack from the same templates would try to create a Lambda function with the exact same name as prod, which collides. Needs a `!Sub '${ResourcePrefix}...'` fix before a staging stack is actually stood up.
- **`BlockTableName` (Blocks) is still an unmanaged, externally-referenced parameter** — same category `TABLE_NAME`/`S3BucketName` used to be before they were fixed. There's no `infra/blocks.yaml`, no real CFN-managed table backing it. `env.staging.json`'s `BLOCK_TABLE_NAME` was updated to `staging-sale-sync-block` (matching the `ResourcePrefix` convention everywhere else), but unlike the other tables, nothing actually creates that table — it needs to already exist by that name, or a real `infra/blocks.yaml` needs to be created, mirroring `infra/auth.yaml`/`infra/organisation.yaml`. Not done yet — flagging for the same kind of explicit go-ahead the earlier fixes got.

## Adding a new nested stack

1. Create `infra/<name>.yaml` following the existing pattern: a `ResourcePrefix` parameter, `DeletionPolicy: Retain` / `UpdateReplacePolicy: Retain` on every stateful resource, `!Sub '${ResourcePrefix}sale-sync-<name>'` naming, and an `Outputs` block.
2. Add a `<Name>InfraStack` resource in `template.yaml`: `AWS::Serverless::Application`, `Location: ./infra/<name>.yaml`, `Parameters: { ResourcePrefix: !Ref ResourcePrefix }`, `DeletionPolicy`/`UpdateReplacePolicy: Retain`.
3. Wire the Lambda(s) that need it via `Environment.Variables`, using `!GetAtt <Name>InfraStack.Outputs.<Output>` — not a bare `!Ref` parameter, so the value can never drift from what's actually deployed.
4. Scope its `Policies` to that specific resource (`DynamoDBCrudPolicy`/`DynamoDBReadPolicy`/`S3CrudPolicy` with the `!GetAtt` output) — never an AWS-managed full-access policy.
5. Add the new resource's name/ARN to the root `template.yaml` `Outputs` block for visibility.
6. If it's a table other services should be able to discover, document its key schema under [`docs/dynamodb/`](../dynamodb/).
