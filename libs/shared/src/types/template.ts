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
    | 'locations';

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
// (About, Privacy Policy, Terms & Conditions all share this shape and this generator). `null` means
// no generator is wired up yet — true for every `render: 'csr'` page (nothing to bake ahead of
// time) and for any `render: 'ssr'`/`'hybrid'` page whose generator hasn't been built yet (e.g.
// Articles' slug-list shape, FAQ's two-level-repeater shape, as of 2026-09-12).
export type PageGenerator = 'blocknote-singleton' | null;

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
