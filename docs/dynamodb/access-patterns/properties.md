## Property

### Overview

A **Property** is a single real-estate listing (house, condo, commercial unit, or land) owned by an organisation. This is the org-managed source data behind theme-maker's `property-map-view` feature — a Leaflet map + listing UI that theme-maker ships on every page of a real-estate consumer project (see `~/projects/ss/theme-maker/docs/PropertyMapView.md`). Today that feature reads a hand-written `Property[]` array baked into `wello/slices/PropertyMapViewSlice/data.ts`; this design gives that data a DynamoDB-backed source so it can be managed through the org dashboard instead of edited by hand, and exported at build/generation time into the same `data-properties` JSON shape the frontend already expects.

Property is served by its own standalone Lambda (`properties/`) backed by its own dedicated DynamoDB table (`sale-sync-properties`, provisioned by the `PropertiesInfraStack` nested stack — see `templates/properties.yaml`), not folded into the shared `sale-sync-organisation` table the way `template.md`/`plan.md` are. Its 3 GSIs ship as CloudFormation alongside the table, so there's no manual AWS-console step to stand up the indexes. See `docs/dynamodb/tables.md`'s "Properties table" section for the infra summary.

There are three kinds of data in this design:

- **Property listing** — one item per listing. Even on its own table, the `PK` still carries `ORG#{org_uuid}#PROPERTY` (rather than dropping the `org_uuid` prefix now that there's no other tenant's data to collide with) — every access pattern below is always scoped to one org, so keeping that scoping explicit in the key costs nothing and avoids a future accidental cross-org scan.
- **Units** — embedded directly on the property item as a `units` array, not normalized into their own items. `PropertyMapView.md`'s `Unit[]` is only ever read together with its parent `Property` (unit cards inside the detail modal carousel); no access pattern needs to fetch a single unit independent of its listing.
- **Filter GSIs** — the map view's fixed footer exposes two independent filters, a location dropdown and a type-filter icon row (see `PropertyMapView.md`). Two of the three GSIs mirror those two axes so a management UI (or the build-time export) can list by area or by type without a full table scan; the third (region) is described below.

The business is expanding beyond Thailand — Australia and Thailand first, worldwide after — so `area_key` is **not** a fixed two-value enum (`"chiangmai" | "bangkok"`) the way theme-maker's inline comment implies for wello specifically. It's an org-defined city/region slug, and every listing also carries a `country` (ISO 3166-1 alpha-2, e.g. `"TH"`, `"AU"`) so the area GSI can scope by country first and by area within it — see the GSI1 key shape below.

Different markets search at different levels of a **Country → Region (state/province) → Area** hierarchy, and this schema doesn't force every market into the same depth — see `docs/market-behaviour.md` for the AU/TH research behind these choices:

- `country` — required, universal (every listing has one).
- `region` — **optional**, e.g. `"NSW"` for Australia (state matters — realestate.com.au/domain.com.au both surface it), left `null` for Thailand (buyers there search by city/area, not by changwat/province). Other markets can populate it or not, whichever matches how people actually search there.
- `area_key` — required; the market's primary search granularity — a city for Thailand (`"chiangmai"`, `"bangkok"`), a suburb for Australia (`"bondi"`, `"toorak"`). `location` remains the free-text full address for display.

Because `region` is optional and sparse, it gets its own GSI (`property-region-index`, GSI3) rather than being folded into GSI1's key — DynamoDB GSIs are sparse by default, so items without a `region` (e.g. every TH listing) simply don't appear in it, at no extra cost.

Gating is enforced at the service layer, not in the key: only organisations with `business_category = "real-estate"` (see `organisation.md`'s `BusinessCategory`) expose Property CRUD — same precedent as how `template.md`'s catalogue is scoped by category read off the org metadata.

### Table Structure — DynamoDB Item Layout

| Key      | Index                 | Value Pattern                          | Purpose                                                                     |
| -------- | --------------------- | --------------------------------------- | ----------------------------------------------------------------------------- |
| `PK`     | `main table`          | `ORG#{org_uuid}#PROPERTY`              | Partition key — groups all property listings owned by an organisation        |
| `SK`     | `main table`          | `PROPERTY#{property_uuid}`             | Sort key — uniquely identifies a listing; supports point lookup              |
| `GSI1PK` | `property-area-index` | `ORG#{org_uuid}#PROPERTY#COUNTRY#{country}` | Groups listings by country (drives country scoping as more markets launch) |
| `GSI1SK` | `property-area-index` | `AREA#{area_key}#PROPERTY#{property_uuid}` | Groups by area within a country (drives the location dropdown filter)      |
| `GSI2PK` | `property-type-index` | `ORG#{org_uuid}#PROPERTY#TYPE#{type}`  | Groups listings by type (drives the map view's type-filter icon row)         |
| `GSI2SK` | `property-type-index` | `PROPERTY#{property_uuid}`             | Sort key within a type                                                        |
| `GSI3PK` | `property-region-index` | `ORG#{org_uuid}#PROPERTY#COUNTRY#{country}#REGION#{region}` | Groups listings by state/province, for markets where that's meaningful. **Sparse** — omitted entirely when `region` is `null` |
| `GSI3SK` | `property-region-index` | `AREA#{area_key}#PROPERTY#{property_uuid}` | Groups by area within a region                                              |

### Index Summary

| Index Name                          | Partition Key                                        | Sort Key                                | What It Enables                                            |
| ------------------------------------ | ------------------------------------------------------ | ----------------------------------------- | ------------------------------------------------------------- |
| `main table`                        | `PK = ORG#{org_uuid}#PROPERTY`                         | `SK = PROPERTY#{property_uuid}`         | Direct get/put/delete by ID                                    |
| `property-area-index`<br>`(GSI1)`   | `GSI1PK = ORG#{org_uuid}#PROPERTY#COUNTRY#{country}`   | `GSI1SK = AREA#{area_key}#PROPERTY#{property_uuid}` | List all listings in a country, or narrow to one area via `begins_with(GSI1SK, "AREA#{area_key}#")` (location dropdown) |
| `property-type-index`<br>`(GSI2)`   | `GSI2PK = ORG#{org_uuid}#PROPERTY#TYPE#{type}`         | `GSI2SK = PROPERTY#{property_uuid}`     | List listings of a type (type-filter icon row)                 |
| `property-region-index`<br>`(GSI3)` | `GSI3PK = ORG#{org_uuid}#PROPERTY#COUNTRY#{country}#REGION#{region}` | `GSI3SK = AREA#{area_key}#PROPERTY#{property_uuid}` | List listings in a state/province (AU-style markets); sparse — TH listings (no `region`) never appear here |

### Access Patterns

| Pattern                                                                                                   | Key Condition                                                                                                                                                                                                                 | Command         | Index                                |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | -------------------------------------- |
| Create property listing<br><br>`fn: createProperty`                                                        | `PK = ORG#{org_uuid}#PROPERTY`<br>`SK = PROPERTY#{property_uuid}`<br><br>Units embedded inline; `GSI1PK`/`GSI1SK`/`GSI2PK` set from `country`/`area_key`/`type` at creation<br><br>`GSI3PK`/`GSI3SK` set too, but only if `region` is non-null                                                     | `PutCommand`    | `main table`                          |
| Get property by ID                                                                                          | `PK = ORG#{org_uuid}#PROPERTY`<br>`SK = PROPERTY#{property_uuid}`                                                                                                                                                              | `GetCommand`    | `main table`                          |
| List all properties for an org<br><br>_Used to export the theme-maker `data-properties` JSON at build time_ | `PK = ORG#{org_uuid}#PROPERTY`<br>`begins_with(SK, "PROPERTY#")`                                                                                                                                                                | `QueryCommand`  | `main table`                          |
| List properties by country<br><br>_e.g. an org's AU site vs. TH site at build time_                          | `GSI1PK = ORG#{org_uuid}#PROPERTY#COUNTRY#{country}`                                                                                                                                                                            | `QueryCommand`  | `property-area-index`<br>`(GSI1)`    |
| List properties by area within a country<br><br>_Location dropdown filter (dashboard / future public API)_  | `GSI1PK = ORG#{org_uuid}#PROPERTY#COUNTRY#{country}`<br>`begins_with(GSI1SK, "AREA#{area_key}#")`                                                                                                                               | `QueryCommand`  | `property-area-index`<br>`(GSI1)`    |
| List properties by type<br><br>_Type-filter icon row (dashboard / future public API)_                       | `GSI2PK = ORG#{org_uuid}#PROPERTY#TYPE#{type}`                                                                                                                                                                                  | `QueryCommand`  | `property-type-index`<br>`(GSI2)`    |
| List properties by region<br><br>_State/province filter for markets that use one, e.g. AU dashboard "NSW" filter_ | `GSI3PK = ORG#{org_uuid}#PROPERTY#COUNTRY#{country}#REGION#{region}`<br><br>Note: no results for markets that leave `region` null — use "List properties by country" instead                                            | `QueryCommand`  | `property-region-index`<br>`(GSI3)`  |
| Update property<br><br>`fn: updateProperty`                                                                 | `PK = ORG#{org_uuid}#PROPERTY`<br>`SK = PROPERTY#{property_uuid}`<br><br>If `country`, `area_key`, or `type` changes, `GSI1PK`/`GSI1SK`/`GSI2PK` must be rewritten in the same write — they're plain projected attributes, not separate items<br><br>If `region` changes (including from/to `null`), `GSI3PK`/`GSI3SK` must be added, updated, or removed accordingly | `UpdateCommand` | `main table`                          |
| Delete property<br><br>`fn: deleteProperty`                                                                 | `PK = ORG#{org_uuid}#PROPERTY`<br>`SK = PROPERTY#{property_uuid}`                                                                                                                                                              | `DeleteCommand` | `main table`                          |

### Typescript Types

Adapted from `property-map-view-init.ts`'s frontend types (see `PropertyMapView.md`'s "Data shape"), trimmed to the org-owned source-of-truth fields — see Key Design Notes for what's excluded and why.

##### PropertyCountry

```ts
// ISO 3166-1 alpha-2. Launch markets are TH and AU; more added as the business expands worldwide.
export type PropertyCountry = 'TH' | 'AU' | (string & {})
```

##### PropertyRegion

```ts
// State/province, free text — only meaningful for markets that search by it (e.g. AU: "NSW", "VIC").
// null for markets where it isn't part of how buyers search (e.g. TH).
export type PropertyRegion = string | null
```

##### PropertyAreaKey

```ts
// Org-defined city/suburb slug — the market's primary search granularity, scoped by
// PropertyCountry (+ PropertyRegion where populated). Not a fixed enum.
// e.g. "chiangmai" | "bangkok" for TH (city-level), "bondi" | "toorak" for AU (suburb-level).
export type PropertyAreaKey = string
```

##### PropertyType

```ts
export type PropertyType = 'house' | 'condo' | 'commercial' | 'land'
```

##### Unit

```ts
export type Unit = {
	uuid: string
	title: string
	image: string | null
	sellPrice: number | null
	sellDiscountPrice: number | null
	sellMaxPrice: number | null
	beds: number | null
	baths: number | null
	hall: number | null
	kitchen: number | null
	pantry: number | null
	car: number | null
	unitSize: number | null
	landSize: number | null
	size: string | null
	condition: string | null
	furnishing: string | null
}
```

##### Property

```ts
export type Property = {
	uuid: string
	title: string
	typeLabel: string
	postedLabel: string
	lat: number
	lng: number
	location: string
	country: PropertyCountry
	region: PropertyRegion
	area_key: PropertyAreaKey
	type: PropertyType
	sellPrice: number | null
	sellDiscountPrice: number | null
	sellMaxPrice: number | null
	code: string | null
	isLeasehold: boolean
	brochure: string | null
	image: string | null
	images: string[]
	description: string | null
	payment: string | null
	units: Unit[]
	created_at: string // ISO timestamp
	updated_at: string // ISO timestamp
	// NOT stored — see Key Design Notes:
	// favorite, hidden        → per-visitor state, no org identity to key it to
	// selectedUnitId, tags    → computed by property-map-view-init.ts at parse time
}
```

### Table Structure — Item Examples

| `PK`                       | `SK`                    | `GSI1PK`                             | `GSI1SK`                                    | `GSI2PK`                             | `GSI3PK`                                            | `GSI3SK`                                | Attributes       |
| --------------------------- | ------------------------ | --------------------------------------- | ---------------------------------------------- | --------------------------------------- | ------------------------------------------------------- | ---------------------------------------- | ----------------- |
| `ORG#org_abc123#PROPERTY`  | `PROPERTY#prop_uuid_1`  | `ORG#org_abc123#PROPERTY#COUNTRY#TH`   | `AREA#chiangmai#PROPERTY#prop_uuid_1`         | `ORG#org_abc123#PROPERTY#TYPE#condo`   | _(omitted — `region` is `null`)_                       | _(omitted)_                              | `data: Property` |
| `ORG#org_abc123#PROPERTY`  | `PROPERTY#prop_uuid_2`  | `ORG#org_abc123#PROPERTY#COUNTRY#TH`   | `AREA#bangkok#PROPERTY#prop_uuid_2`           | `ORG#org_abc123#PROPERTY#TYPE#house`   | _(omitted — `region` is `null`)_                       | _(omitted)_                              | `data: Property` |
| `ORG#org_abc123#PROPERTY`  | `PROPERTY#prop_uuid_3`  | `ORG#org_abc123#PROPERTY#COUNTRY#AU`   | `AREA#bondi#PROPERTY#prop_uuid_3`             | `ORG#org_abc123#PROPERTY#TYPE#land`    | `ORG#org_abc123#PROPERTY#COUNTRY#AU#REGION#NSW`        | `AREA#bondi#PROPERTY#prop_uuid_3`       | `data: Property` |

### Key Design Notes

- **Units are embedded, not normalized** — `units` lives inline on the `Property` item as an array. There is no access pattern that needs a unit independent of its parent listing (the detail-modal carousel always loads all of a listing's units together), so a separate `UNIT#` item type would only add write complexity for no query benefit.
- **Two GSIs mirror the two independent filter axes** — `PropertyMapView.md` describes the map view footer as a location dropdown *and* a separate type-filter icon row, applied independently. Today wello bakes its entire `Property[]` into the page and both filters run client-side in the browser against the full baked array (`property-map-view-init.ts`), so these GSIs aren't hit per-filter-click yet — they exist for the org-management dashboard's own list/filter views and for scoping the build-time export (e.g. only exporting one area to a region-specific site).
- **`country` + `area_key` are not a fixed enum** — the business is going worldwide, launching with Australia and Thailand. `area_key` is an org-defined city/suburb slug (`"chiangmai"`, `"bondi"`, etc.), not the two-value union theme-maker's inline comment implies for wello. `property-area-index`'s `GSI1PK` scopes by `country` first, with `area_key` folded into `GSI1SK` — that supports "list every listing in a country" (e.g. exporting an org's AU site separately from its TH site) as well as "list listings in one area," and avoids two orgs (or two countries) colliding on the same city slug.
- **`region` is optional and market-dependent, not a required tier** — different countries search location at different depths of a Country → Region (state/province) → Area hierarchy. Australia surfaces state (`"NSW"`) prominently (realestate.com.au, domain.com.au); Thailand doesn't — buyers search by city/area, not by changwat/province. Rather than force every market to populate a field that's meaningless to it (or invent a placeholder), `region` is nullable and gets its **own sparse GSI** (`property-region-index`, GSI3): only items with a non-null `region` get `GSI3PK`/`GSI3SK` attributes at all, so TH listings simply never appear in it — no wasted capacity, no sentinel values, and no schema change needed as more markets (each with their own conventions) are added later.
- **`favorite` / `hidden` / `selectedUnitId` / `tags` are intentionally excluded** from the stored `Property` type. `PropertyMapView.md` explicitly marks `selectedUnitId` and `tags` as "computed at runtime, not baked in" by `property-map-view-init.ts`. `favorite` and `hidden` are per-**visitor** drawer state on a site with no visitor auth — they aren't organisation data at all, and are almost certainly meant to be seeded `false` at parse time and then overlaid from the visitor's own `localStorage`. Storing them on the org's `Property` item would let one visitor's favorite/hidden toggle leak into every other visitor's view of the same listing.
- **`uuid` vs. the frontend's numeric `id`** — every other access-pattern doc in this repo (`template.md`, `organisation.md`) keys entities by uuid string, so `Property`/`Unit` here follow suit with `property_uuid`/a `uuid` field on `Unit`. `PropertyMapView.md`'s own `Property.id`/`Unit.id` are typed `number`, though — whatever build step exports DynamoDB `Property` records into the `data-properties` JSON needs to either map uuid → a stable numeric id, or theme-maker's type needs to widen to `string`. Flagging this now rather than picking silently, since it's a cross-repo contract between this service and theme-maker.
- **No `business_category` in the key** — enforced at the service layer only (reject Property CRUD unless the org's `business_category` is `"real-estate"`), the same pattern `template.md` uses for its catalogue lookups via org metadata, not baked into the partition/sort key. Since Property lives in its own table, this check is a deliberate **cross-table read**: `properties/services/property.service.ts` reads the org's metadata item from `sale-sync-organisation` (env var `ORGANISATION_TABLE_NAME`) before `createProperty` proceeds. The Properties Lambda's IAM role gets a scoped `DynamoDBReadPolicy` on that table for exactly this purpose — see `docs/dynamodb/tables.md`.
- **Updating `country`, `region`, `area_key`, or `type` rewrites the GSI attributes in place** — `GSI1PK`/`GSI2PK`/`GSI3PK` (and their SKs) are plain attributes projected by DynamoDB, not separate items, so `updateProperty` just needs to `SET` (or, for `region` going to `null`, `REMOVE`) the relevant attributes in the same `UpdateCommand`; no cleanup of a stale item is required.
