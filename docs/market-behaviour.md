# Real-Estate Market Behaviour — Australia & Thailand

Early-stage focus markets for the real-estate vertical. This documents how buyers actually search and what they expect to see, so the `Property` schema (`docs/dynamodb/access-patterns/properties.md`) and any search/filter UI built on it match real usage instead of a generic global model.

## Australia (`AU`)

**How they search:** suburb- or postcode-first. A user types a suburb name or postcode into a single search box (autocomplete/typeahead, not a drill-down menu) — this is the realestate.com.au / domain.com.au pattern and is what most buyers expect. State is shown as context (breadcrumb, "NSW" badge) but is rarely typed directly.

- Hierarchy used: **Country → Region (state) → Suburb (`area_key`)**. `region` should be populated (`"NSW"`, `"VIC"`, `"QLD"`, `"WA"`, `"SA"`, `"TAS"`, `"ACT"`, `"NT"`).
- `location` (free text) is typically `"{Suburb}, {STATE} {Postcode}"`, e.g. `"Bondi, NSW 2026"`.

**Property types:** house, apartment/unit ("condo" doesn't exist as a term — map `type: "condo"` to "apartment"/"unit" in UI copy), townhouse, land, rural/acreage, commercial. The underlying `type` enum stays generic; mapping it to the AU-facing display term is a UI-layer concern, not a stored field.

**Ownership:** the overwhelming majority of residential listings are **freehold**. `isLeasehold` will be `false` for nearly every AU listing — it mainly applies to some retirement villages, crown leases (rare, mostly NT/ACT ground leases), and strata company-title edge cases. Don't surface a leasehold filter prominently for AU; it's noise there.

**Price display:** `AUD`, whole listing price shown directly for most residential (`"$850,000"`), but auction/negotiation listings commonly show **no price** — `"Contact Agent"`, `"Auction"`, or a price guide range (`sellPrice`–`sellMaxPrice`) instead of a single figure. `sellDiscountPrice` (a "reduced from" price) is common for stale listings. Commercial listings often use `"POA"` (Price On Application) — model as `sellPrice: null`.

**Units:** land/floor size in **square metres**; older listings sometimes still reference "squares" (1 square ≈ 9.29 m²) informally in the description but the structured field should stay metric. Bedrooms/bathrooms/car spaces (not "car" as an odd single word — `car` in the `Unit` type maps to "car spaces"/garage count) are the standard trio buyers filter by, alongside price and property type.

## Thailand (`TH`)

**How they search:** city/area-first, not province-first. Buyers (a large share are foreign investors, especially in Bangkok, Chiang Mai, Phuket, Pattaya) search by city and then neighborhood/district (e.g. "Bangkok" → "Sukhumvit", "Chiang Mai" → "Nimman"). Province (changwat) is an administrative unit, not a buyer-facing search concept — this is why `region` should stay `null` for TH listings; forcing a province field into the search UI would confuse rather than help.

- Hierarchy used: **Country → City/Area (`area_key`)** only — no meaningful middle tier. `area_key` values are city-level (`"bangkok"`, `"chiangmai"`, `"phuket"`) or, where an org wants finer granularity, neighborhood-level (`"sukhumvit"`, `"nimman"`); either is valid since it's org-defined.
- `location` (free text) is typically `"{Neighborhood}, {City}"`, e.g. `"Nimman, Chiang Mai"`.
- `postcode` (added 2026-07-16): Thailand has a standard 5-digit postal code system (e.g. Bangkok `10110`, Chiang Mai `50200`), but it is **not** a documented buyer-facing search pattern here the way it is for AU — TH buyers search city/neighborhood-first (see above), not by postcode. It's populated as optional, informational metadata rather than a primary search field, mainly because the TH buyer base skews heavily foreign and a postal code supports shipping/documentation needs. Unlike `region` (which stays fully `null` for TH), `postcode` should be filled in when known.

**Property types:** house, condo (the dominant term for apartment-style units — unlike AU, "condo" is exactly right here), commercial, land, townhouse (often called "townhome"). Condos are usually the largest single category for foreign-buyer-facing sites.

**Ownership — this is the field that matters most for TH:** Thai law caps **foreign freehold ownership of condo units at 49% of a building's total unit area**; foreigners generally cannot hold freehold title on land at all. As a result:
- `isLeasehold` is a **primary filter** for TH listings, not an edge case — many condo units and most house/land listings marketed to foreigners are leasehold (typically 30-year renewable terms) specifically because freehold quota or land-ownership rules block a straight purchase.
- Expect listings to explicitly call out "Freehold Quota Available" vs. "Leasehold" in `description`/`payment`, and expect buyers to filter on this before anything else once ownership nationality is a factor.

**Price display:** `THB`, prices shown as full listing price (`"฿4,500,000"`) or, for large developments, "starting from" (`sellPrice` as the unit's minimum, `sellMaxPrice` as a penthouse/premium unit's price). Foreign-facing listings frequently show a secondary USD-equivalent for reference — that's a display-layer conversion, not a stored field.

**Units:** land is measured in **rai / ngan / wah** (1 rai = 4 ngan = 400 wah ≈ 1,600 m²) in addition to or instead of square metres — a TH land listing's `landSize` should carry a unit-aware value (either normalize to m² and label it, or keep the local unit — flag this as an open question for whoever implements the field, since `PropertyMapView.md`'s `landSize: string | null` is already a free-text string rather than a bare number, which suggests the frontend expects the unit baked into the display string, e.g. `"2 Rai"`). Condo unit size is in square metres, matching international convention.

## Cross-market implications for the schema

- `region` nullability (already in `properties.md`) is directly driven by this: AU needs it, TH doesn't — confirmed by how each market's real-estate portals are actually structured, not a guess.
- `postcode` is the one location field that's populated for *both* markets rather than being market-exclusive: required and search-driving for AU, optional and informational-only for TH.
- `isLeasehold` should not be treated as a rarely-used boolean — for TH it's close to a required filter; for AU it's closer to always-false. Any future "primary filters" list in the map view's UI should be market-aware rather than one fixed set for every org.
- `type`'s enum (`'house' | 'condo' | 'commercial' | 'land'`) covers both markets' vocabulary reasonably well as *stored* values, but the display term needs to diverge — "condo" reads naturally in TH listings, "apartment"/"unit" in AU ones. Since there's no per-listing display-string field, this mapping (`type` → market-appropriate label) is UI-layer logic, keyed off `type` + `country`, not stored data.
- Land-size units differ by market (m² vs. rai/ngan/wah) — worth confirming with whoever builds the property-management form whether `landSize` stays a free-text display string (matching theme-maker's existing type) or gets a structured `{ value, unit }` shape before more countries are added.
