# Data Model — Website

Tracks deployed `theme-maker` sites (S3 + CloudFront stacks) so there's a queryable record of what's
live where, instead of only each theme's local `.env`/CFN outputs. Two row shapes share the table:
template/staging demo sites (this repo's own QA environment) and per-client production sites (created
by `website-client-manual-deploy`).

### Access Patterns

##### Template/staging site

| Pattern                 | Key Condition                                             | Command    |
| ------------------------ | ---------------------------------------------------------- | ---------- |
| Get a staging site       | `PK = WEBSITE#TEMPLATE`, `SK = SITE#<theme>`                | GetItem    |
| List all staging sites   | `PK = WEBSITE#TEMPLATE`, `SK begins_with SITE#`             | Query      |
| Register/update a site   | `PK = WEBSITE#TEMPLATE`, `SK = SITE#<theme>`                | PutItem    |

##### Client production site

| Pattern                    | Key Condition                                                     | Command    |
| --------------------------- | -------------------------------------------------------------------- | ---------- |
| Get a client's site         | `PK = ORGANISATION#<organisation_id>#WEBSITE`, `SK = SITE#<site_id>`   | GetItem    |
| List a client's sites       | `PK = ORGANISATION#<organisation_id>#WEBSITE`, `SK begins_with SITE#`  | Query      |
| Register/update a site      | `PK = ORGANISATION#<organisation_id>#WEBSITE`, `SK = SITE#<site_id>`   | PutItem    |

### Data Types

```ts
type Website = {
	theme: string // 'shape' | 'wello' | ...
	environment: 'staging' | 'prod'
	project_name: string // matches the theme's PROJECT_NAME env var
	stack_name: string
	bucket_name: string
	distribution_id: string
	region: string
	domain: string | null // custom domain, null while using the default *.cloudfront.net
	organisation_id: string | null // set when a demo/client org is attached (e.g. wello-organisation); null for theme staging sites with no associated org (e.g. shape)
}
```

### Table Structure

| PK                                    | SK                | Attributes                                |
| -------------------------------------- | ------------------ | ------------------------------------------ |
| `WEBSITE#TEMPLATE`                     | `SITE#<theme>`     | `==data: Website==`, `created_at`, `updated_at` |
| `ORGANISATION#<organisation_id>#WEBSITE` | `SITE#<site_id>`   | `==data: Website==`, `created_at`, `updated_at` |

### Key Design Notes

- **No GSIs.** Every access pattern so far is a direct lookup or a `begins_with` scan within one
  partition — no need to query across themes/orgs by any other attribute yet.
- **`organisation_id` is an item attribute, not part of the key**, on the `WEBSITE#TEMPLATE` rows.
  Template/staging sites are keyed by `theme` regardless of whether a demo org is attached
  (`wello` → `wello-organisation`; `shape` → none). Client production sites don't need this field
  since the organisation is already the partition key.
- **One item per deployed stack**, not per theme — a theme with both a staging and a production
  deploy (e.g. `wello-stack` + `wello-prod-stack`, see `website-staging-environment`'s multi-environment
  `make` targets) gets two distinct `SK`s differentiated by `environment` in the item body, not by key
  shape (`SITE#wello` for staging; a client site under its own organisation for prod, since `wello-prod`
  isn't tied to a real client org yet).
