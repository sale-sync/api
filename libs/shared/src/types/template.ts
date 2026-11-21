import type { BrandingColor, BusinessCategory, ThemeFont } from './organisation';

// Mirrors theme-maker's own pageType/pageCategory convention (theme-maker/packages/types.ts) —
// declared independently here, not imported, since api/ has no dependency on the @sale-sync/theme-maker
// package. pageType is free-form/consumer-declared in theme-maker itself (kept as a union there only
// for editor safety); listed here as the known values as of 2026-09-10, not enforced as exhaustive.
//
// 'blocknote' (renamed from 'wysiwyg' 2026-09-10): theme-maker's own PageType union and
// shape/pages/about.ts still use 'wysiwyg' as of this date — this rename is API-side/catalogue-side
// only, deliberately not propagated back to theme-maker's published package. 'wysiwyg' was always a
// generic placeholder ("some rich-text editor, TBD" — see docs/theme-maker/SHAPE.md); 'blocknote'
// names the actual editor now chosen, replacing the discontinued Slice/Section/Block/Page model
// (see backlogs/website/children/page-generator, discontinued same date).
//
// 'real-estate-home' / 'real-estate-agents' / 'real-estate-map-view' / 'real-estate-properties' /
// 'faq' / 'locations' (added 2026-09-10, for the "Real Estate" template's catalogue `pages` entry):
// business-category-specific dedicated page types, distinct from theme-maker's own
// 'property-map-view'/'agent-list' values used by the actual real-estate/ page source — this is the
// catalogue's own taxonomy for describing a template's pages, not required to match what the live
// theme-maker project's pages/*.ts files literally set as their pageType.
// 'articles' / 'article-detail' (added 2026-09-15, backlogs/real-estate-template/children/
// articles-page-ssr-split): splits what was one 'blocknote'-mislabeled `articles-page` entry (stale
// from before the real Articles feature existed) into the listing (Hero-editable, grid stays CSR)
// and a new per-slug detail page type. 'normal' PageCategory, not 'feature' — Articles is a generic
// page type, not real-estate-exclusive, same reasoning as 'faq'/'locations'.
// 'location-detail' (added 2026-09-17, backlogs/real-estate-template/children/
// locations-page-ssr-split): same split applied to Locations — the existing 'locations' value stays
// on the listing entry unchanged, this new value is for the new per-slug detail page type, same
// 'normal' PageCategory reasoning as 'article-detail'.
export type PageType =
    | 'default'
    | 'timetable'
    | 'available-on'
    | 'blocknote'
    | 'property-map-view'
    | 'agent-list'
    | 'property-search'
    | 'real-estate-home'
    | 'real-estate-agents'
    | 'real-estate-map-view'
    | 'real-estate-properties'
    | 'faq'
    | 'locations'
    | 'articles'
    | 'article-detail'
    | 'location-detail'
    | 'contact';

// Redefined 2026-09-10 for the catalogue's `Page` entry — no longer describes rendering behavior
// (see `PageRender` below for that). Now describes reusability scope: "normal" = a generic page type
// usable across multiple business categories (e.g. About, FAQ, Privacy Policy); "feature" = a page
// type exclusive to one business category (e.g. `real-estate-properties-page` only makes sense for
// real estate). theme-maker's own PageCategory (theme-maker/packages/types.ts) keeps its original
// rendering-behavior meaning ("normal" = baked into HTML/SSR JSON, "feature" = own data via
// client-side APIs) — this is a deliberate divergence, catalogue-side only, not propagated back.
export type PageCategory = 'normal' | 'feature';

// How a page is rendered — added 2026-09-10, replacing the rendering-behavior meaning PageCategory
// used to carry (see note above). 'csr' = client-side rendered, 'ssr' = server-side rendered,
// 'hybrid' = a mix (e.g. an SSR shell hydrated with CSR-fetched data).
export type PageRender = 'csr' | 'ssr' | 'hybrid';

// Which regeneration Lambda handles this page's publish → rebuilt-HTML/SSR-JSON step (see
// backlogs/publish-render/children/ssr-pages). Generators are grouped by content shape, not one per
// page — e.g. 'blocknote-singleton' serves any page whose content is a single BlockNote document
// (About, Privacy Policy, Terms & Conditions all share this shape and this generator).
// 'real-estate-home-page' (added 2026-09-13) serves that one page's Hero section — also a singleton
// per-org record, but plain fields (badge/title/subtitle/bannerImage), not a BlockNote document, so
// it patches specific tagged elements rather than one content div. Named after the page itself
// rather than a shared content shape (unlike 'blocknote-singleton') since this shape isn't shared
// with any other page yet — see backlogs/real-estate-template/children/real-estate-home-page-hero.
// `null` means no generator is wired up yet — true for a `render: 'csr'` page with nothing to bake
// ahead of time (see 'real-estate-map-view-page'/'real-estate-properties-page' below for csr pages
// that DO have one, baking only <head> SEO / a Hero) and for any `render: 'ssr'`/`'hybrid'` page whose generator hasn't been built yet
// (e.g. Articles' slug-list shape, FAQ's two-level-repeater shape, as of 2026-09-12).
// 'real-estate-agents-page' (added 2026-09-15) patches just the banner image + overlay opacity on
// the shared `PageHeroSlice` (via a new `id="agentsBanner"` hook passed only from `pages/agents.ts`)
// — see backlogs/real-estate-template/children/real-estate-agents-page-banner. Named after the page
// itself, same "don't invent a shared name preemptively" rule as 'real-estate-home-page': if
// articles/faq/locations/properties (the other `PageHeroSlice` consumers) need the same banner
// editing later, generalize this generator then rather than building a near-duplicate.
// 'article-listing-page' / 'article-detail-page' (added 2026-09-15, shipped 2026-09-16 — see
// backlogs/real-estate-template/children/articles-page-ssr-split): splits the (previously stale)
// single `articles-page` entry into a Hero-only bake (the former) and a genuinely new per-slug
// detail-page generator (the latter — not a copy of any existing generator, since every prior one
// only ever patches an already-built page rather than creating one from nothing). Deliberately NOT
// prefixed 'real-estate-' like 'real-estate-home-page'/'real-estate-agents-page' — Articles is
// `pageCategory: 'normal'` (a generic page type usable across business categories), not `'feature'`
// (real-estate-exclusive), so its generator name shouldn't imply a business-category binding either.
// 'location-listing-page' / 'location-detail-page' (added and shipped 2026-09-17 — see
// backlogs/real-estate-template/children/locations-page-ssr-split): same split as Articles, applied
// to Locations. Singular 'location-' naming mirrors 'article-listing-page'/'article-detail-page'
// exactly (plural pageType, singular generator name) for the same reasons.
// 'faq-page' (added 2026-09-17 — see backlogs/real-estate-template/children/faq-page-hero): Hero +
// SEO become editable/baked for the FAQ page, same pattern as Articles'/Locations' Hero-bake
// generator. Deliberately NOT named 'faq-listing-page' — that '-listing-' qualifier exists on the
// Articles/Locations generators specifically to disambiguate from a sibling '-detail-page'
// generator, which FAQ has no equivalent of (no slugs, no per-item detail route). Named like
// 'real-estate-home-page'/'real-estate-agents-page' instead — single catalogue entry gains a Hero,
// no split.
// 'contact-page' (added 2026-10-11 — see backlogs/contact-page): the shared Contact Us page, usable by
// every business category (pageCategory 'normal', so no 'real-estate-' prefix). Hybrid: title,
// subtitle, Business Information and SEO are baked; the form stays static UI. No hero/banner, no
// detail-page sibling, hence no '-listing-' qualifier either (same naming reasoning as 'faq-page').
// 'real-estate-map-view-page' / 'real-estate-properties-page' (added 2026-09-19 — see
// backlogs/real-estate-template/children/real-estate-map-view-seo and real-estate-properties-page-hero):
// two `render: 'csr'` pages that stay CSR (their live map/filter+grid sections are untouched) but gain a
// generator anyway, because their <head> SEO (Map) or Hero + SEO (Properties) becomes editable and
// baked. `render` deliberately stays 'csr' — nothing branches on it. Named after the page itself,
// with the 'real-estate-' prefix since both are `pageCategory: 'feature'`, no shared generator
// (Map has no Hero, Properties does).
export type PageGenerator =
    | 'blocknote-singleton'
    | 'real-estate-home-page'
    | 'real-estate-agents-page'
    | 'article-listing-page'
    | 'article-detail-page'
    | 'location-listing-page'
    | 'location-detail-page'
    | 'faq-page'
    | 'contact-page'
    | 'real-estate-map-view-page'
    | 'real-estate-properties-page'
    | null;

export type Page = {
    id: string;
    name: string;
    pageType: PageType;
    pageCategory: PageCategory;
    render: PageRender;
    generator: PageGenerator;
};

export type Template = {
    uuid: string;
    name: string;
    business_category: BusinessCategory;
    preview_image: string;
    created_at: string;
    // Optional: existing catalogue rows (e.g. the real "Real Estate" template) predate this field and
    // have no `pages` attribute at all yet — not an empty array, genuinely absent. Added 2026-09-10.
    pages?: Page[];
};

export type OrganisationTemplate = {
    template_uuid: string;
    added_at: string;
};

// Staff-curated color-palette + font preset, scoped to exactly one template. An organisation's own
// theme (its BrandingRecord) is created by deep-copying one of these at org-creation time — editing
// the org's copy afterward never affects the predefined theme it was copied from. Stored in
// WebsiteTable: PK=TEMPLATE#<uuid>, SK=THEME#<uuid>. See backlogs/website/children/
// website-table-templates-themes for the full design history.
export type PredefinedTheme = {
    uuid: string;
    template_uuid: string;
    name: string;
    primaryColor: BrandingColor;
    secondaryColor: BrandingColor;
    font: ThemeFont;
    created_at: string;
};
