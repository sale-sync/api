export type BusinessCategory = 'fitness' | 'real-estate' | 'service-business' | 'restaurant' | 'haircut-and-salon'

export type Image = {
  name: string
  url: string
  size: string
  mime_type: string
}

export type OrganisationStatus = 'pending' | 'active'

// Launch markets for the real-estate vertical. See api/docs/market-behaviour.md.
export type Market = 'TH' | 'AU'

export const MARKET_CURRENCY: Record<Market, string> = {
  TH: 'THB',
  AU: 'AUD',
}

export type Organisation = {
  uuid: string
  id: string
  name: string
  status: OrganisationStatus
  image: Image | null
  business_category: BusinessCategory
  template_id: string
  plan_id: string
  created_at: string
  description?: string
  address: string | null
  market: Market
}

export type OrganisationRole = 'owner' | 'admin' | 'manager' | 'editor' | 'staff' | 'guest'

export type OrganisationUser = {
  role: OrganisationRole
  position?: string
  joined_date: string
  phone?: string
  bio?: string
  timezone?: string
  avatar?: Image | null
}

export type User = {
  status: 'unverified' | 'verified'
  profile: string
}

// ─── Website branding ──────────────────────────
// One record per organisation. `name` is intentionally not part of this shape — it stays
// `Organisation.name`, edited live via the existing `PATCH /organisations` (no draft/publish needed for
// plain text). Website branding is the combination of `Organisation.name` (live) + this record's
// `data.{logo, primaryColor, secondaryColor}` (draft/publish controlled), combined at read time by the
// future queries API. Primary/secondary mirrors the `action.primary`/`action.secondary` semantic roles
// already in `theme-maker/*/design-system/semantic-tokens.ts` (brand vs. accent) — both are now
// client-editable hexes instead of only the primary/brand one.

export type BrandingColorScaleStep = '50' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900' | '950'

export type BrandingColorScale = Record<BrandingColorScaleStep, string>

export type BrandingColor = {
  hex: string
  scale: BrandingColorScale
}

export type BrandingContent = {
  logo: Image | null
  primaryColor: BrandingColor | null
  secondaryColor: BrandingColor | null
}

export type BrandingRecord = {
  data: BrandingContent | null
  draft: BrandingContent | null
  updated_at: string
  published_at: string | null
}
