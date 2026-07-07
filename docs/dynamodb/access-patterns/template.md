## Template & Theme

### Overview

Templates are system-managed, ready-made themes scoped to a `BusinessCategory`. During onboarding, a user selects their business category and then picks one template from that category's catalogue. After onboarding, users may add additional templates to their organisation via settings. An organisation can hold multiple templates but only one is **active** at a time — tracked as `template_id` on the organisation metadata item.

A **Theme** is an organisation-specific configuration of a template — brand color and font. Each org has its own theme per template. When a template is added to an org a theme item is created with defaults; the org can customise it later.

There are three kinds of items in this design:

- **Global template catalogue** — system records; one item per template, keyed under `TEMPLATE`.
- **Organisation template membership** — one item per template an org has added, keyed under `ORG#{org_uuid}`.
- **Organisation theme config** — one item per org-template pair, keyed under `ORG#{org_uuid}`.

The active template is stored as `template_id` (uuid) directly on the organisation metadata item (`PK = ORG`, `SK = META#{org_uuid}`).


### Table Structure — DynamoDB Item Layout

| Key  | Index        | Value Pattern                                      | Purpose                                                                      |
| ---- | ------------ | -------------------------------------------------- | ---------------------------------------------------------------------------- |
| `PK` | `main table` | `TEMPLATE`                                         | Fixed partition grouping all global template catalogue records                |
| `SK` | `main table` | `CAT#{business_category}#TEMPLATE#{template_uuid}` | Scopes templates by category; supports list-by-category and point lookup     |
| `PK` | `main table` | `ORG#{org_uuid}`                                   | Reuses the organisation partition (also holds `USER#` items)                 |
| `SK` | `main table` | `TEMPLATE#{template_uuid}`                         | Identifies a template the organisation has added                             |
| `SK` | `main table` | `THEME#{template_uuid}`                            | Stores the org's theme config for a specific template                        |


### Access Patterns

#### Template

| Pattern                                                                              | Key Condition                                                                                                                                                                                                                                                                          | Command                                          | Index        |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------ |
| Create template<br><br>_System-only — not exposed via API_                           | `PK = TEMPLATE`<br>`SK = CAT#{business_category}#TEMPLATE#{template_uuid}`                                                                                                                                                                                                             | `PutCommand`                                     | `main table` |
| List templates by business category<br><br>_Used during onboarding_                  | `PK = TEMPLATE`<br>`begins_with(SK, "CAT#{business_category}#TEMPLATE#")`                                                                                                                                                                                                              | `QueryCommand`                                   | `main table` |
| Get template by ID                                                                   | `PK = TEMPLATE`<br>`SK = CAT#{business_category}#TEMPLATE#{template_uuid}`<br><br>Note: `business_category` is always known from the org metadata, so no GSI is needed                                                                                                                 | `GetCommand`                                     | `main table` |
| Add template to organisation<br><br>_Onboarding (initial) and settings (additional)_ | `1. Put template membership`<br><br>`PK = ORG#{org_uuid}`<br>`SK = TEMPLATE#{template_uuid}`<br><br>-----<br><br>`2. Put theme with defaults`<br><br>`PK = ORG#{org_uuid}`<br>`SK = THEME#{template_uuid}`                                                                             | `TransactWriteCommand`                           | `main table` |
| List organisation's templates<br><br>_Used in settings to show all added templates_  | `PK = ORG#{org_uuid}`<br>`begins_with(SK, "TEMPLATE#")`                                                                                                                                                                                                                                | `QueryCommand`                                   | `main table` |
| Remove template from organisation                                                    | `1. Delete template membership`<br><br>`PK = ORG#{org_uuid}`, `SK = TEMPLATE#{template_uuid}`<br><br>-----<br><br>`2. Delete theme config`<br><br>`PK = ORG#{org_uuid}`, `SK = THEME#{template_uuid}`<br><br>Note: cannot remove the currently active template; guard in service layer | `TransactWriteCommand`                           | `main table` |
| Set active template<br><br>_Change which template is currently active_               | `1. Verify template is in org's collection`<br><br>`PK = ORG#{org_uuid}`, `SK = TEMPLATE#{template_uuid}`<br><br>-----<br><br>`2. Update org metadata`<br><br>`PK = ORG`, `SK = META#{org_uuid}`<br>`SET data.template_id = template_uuid`                                             | `GetCommand`<br><br>-----<br><br>`UpdateCommand` | `main table` |
| Get active template<br><br>_Resolve the org's current active template_               | `1. Read template_id from org metadata`<br><br>`PK = ORG`, `SK = META#{org_uuid}`<br><br>-----<br><br>`2. Fetch template from catalogue`<br><br>`PK = TEMPLATE`, `SK = CAT#{business_category}#TEMPLATE#{template_id}`                                                                 | `GetCommand`<br><br>-----<br><br>`GetCommand`    | `main table` |

#### Theme

| Pattern                                                                   | Key Condition                                                                                                  | Command         | Index        |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------- | ------------ |
| Get theme for a template                                                  | `PK = ORG#{org_uuid}`<br>`SK = THEME#{template_uuid}`                                                         | `GetCommand`    | `main table` |
| Update theme<br><br>_Org configures brand color and/or font_              | `PK = ORG#{org_uuid}`<br>`SK = THEME#{template_uuid}`<br>`SET data.brand_color = ...`, `SET data.font = ...`  | `UpdateCommand` | `main table` |


### Typescript Types

##### Template

```ts
export type Template = {
	uuid: string
	name: string
	business_category: BusinessCategory
	preview_image: string // url
	created_at: string
}
```

##### OrganisationTemplate

```ts
export type OrganisationTemplate = {
	template_uuid: string
	added_at: string
}
```

##### ThemeBrandColor

Derived from the named color scales in `primitive-tokens.ts`. The `500` value of the chosen scale is treated as the base brand color; the full scale is generated from it.

```ts
export type ThemeBrandColor = 'red' | 'orange' | 'blue' | 'purple' | 'green' | 'amber' | 'gray' | 'stone'
```

##### ThemeFont

Derived from `fontFamily` in `primitive-tokens.ts`.

```ts
export type ThemeFont = 'sans' | 'mono'
```

##### ThemeConfig

```ts
export type ThemeConfig = {
	template_uuid: string
	brand_color: ThemeBrandColor
	font: ThemeFont
	updated_at: string
}
```


### Table Structure — Item Examples

| `PK`                   | `SK`                                          | Attributes                                          |
| ---------------------- | --------------------------------------------- | --------------------------------------------------- |
| `TEMPLATE`             | `CAT#fitness#TEMPLATE#tmpl_uuid_1`            | `data: Template`                                    |
| `TEMPLATE`             | `CAT#fitness#TEMPLATE#tmpl_uuid_2`            | `data: Template`                                    |
| `TEMPLATE`             | `CAT#real-estate#TEMPLATE#tmpl_uuid_3`        | `data: Template`                                    |
| `ORG#org_abc123`       | `TEMPLATE#tmpl_uuid_1`                        | `data: OrganisationTemplate`                        |
| `ORG#org_abc123`       | `TEMPLATE#tmpl_uuid_2`                        | `data: OrganisationTemplate`                        |
| `ORG#org_abc123`       | `THEME#tmpl_uuid_1`                           | `data: ThemeConfig`                                 |
| `ORG#org_abc123`       | `THEME#tmpl_uuid_2`                           | `data: ThemeConfig`                                 |
| `ORG` _(org metadata)_ | `META#org_abc123`                             | `data: Organisation` ← `template_id = tmpl_uuid_1` |


### Key Design Notes

- **Templates are system data** — created via internal scripts or admin tooling only; not exposed through the API. CRUD for the catalogue lives outside normal API flows.
- **Category isolation** — templates are partitioned by `business_category` in the SK, so listing templates for onboarding is a single `Query` with a prefix condition. No cross-category contamination is possible.
- **No GSI needed for template lookup** — because `business_category` is stored on the org metadata, the service always knows the category and can construct the full SK for a `GetCommand`.
- **Theme is created alongside membership** — when adding a template to an org, both the `TEMPLATE#` membership item and the `THEME#` config item are written in a single `TransactWriteCommand`. The theme is initialised with a default color and font. Same transaction applies on removal.
- **Active template guard** — before removing a template from an org, the service must check that `template_uuid !== org.template_id`. Removing the active template would leave the org in an inconsistent state.
- **Onboarding flow** — on completion, three writes happen atomically via `TransactWriteCommand`: `TEMPLATE#` membership, `THEME#` config (defaults), and `template_id` on org metadata.
- **`ORG#{org_uuid}` partition is shared** — `USER#`, `TEMPLATE#`, and `THEME#` items coexist in the same partition. List queries use `begins_with` on the SK to isolate each entity type.
- **`ThemeBrandColor` maps to a full scale** — the stored value is a palette name (e.g. `blue`), not a hex. The theme-maker derives the full 50–950 scale from `primitive-tokens.ts` at render time, keeping the stored data lean.
