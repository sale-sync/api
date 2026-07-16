// ISO 3166-1 alpha-2, deliberately kept open rather than a closed enum — launch markets are
// TH and AU, more added as the business expands worldwide.
// See docs/dynamodb/access-patterns/properties.md and docs/market-behaviour.md.
export type PropertyCountry = string

// State/province — only meaningful for markets that search by it (e.g. AU: "NSW", "VIC").
// null for markets where it isn't part of how buyers search (e.g. TH).
export type PropertyRegion = string | null

// Org-defined city/suburb slug — the market's primary search granularity, scoped by
// PropertyCountry (+ PropertyRegion where populated). Not a fixed enum.
export type PropertyAreaKey = string

export type PropertyType = 'house' | 'condo' | 'commercial' | 'land'

// Audience-based visibility (content-scope-visibility): 'public' = the org's public website,
// 'staff' = dashboard, all members except guest-role, 'guest' = dashboard, all members including
// guest-role. Not a strict hierarchy — 'guest' is the widest internal audience, not the narrowest.
export type PropertyScope = 'public' | 'staff' | 'guest'

// Listing status for a unit. 'buy' pairs with the existing sellPrice/sellDiscountPrice/sellMaxPrice;
// 'sold'/'rent' each get their own price field (soldPrice/rentPrice) rather than reusing sell*.
export type UnitTag = 'buy' | 'rent' | 'sold'

export type Unit = {
  uuid: string
  title: string
  image: string | null
  tag: UnitTag
  sellPrice: number | null
  sellDiscountPrice: number | null
  sellMaxPrice: number | null
  soldPrice: number | null
  rentPrice: number | null
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
  scope: PropertyScope
  // URL-safe identifier for the public read path (queries-api's GET /properties?slug=<slug>),
  // unique per-organisation (not globally). Nullable — records written before this field existed
  // have no slug and simply aren't publicly linkable until edited to add one.
  slug: string | null
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
  created_at: string
  updated_at: string
}
