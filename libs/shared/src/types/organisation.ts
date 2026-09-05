export type BusinessCategory = 'fitness' | 'real-estate' | 'service-business' | 'restaurant' | 'haircut-and-salon';

export type Image = {
    name: string;
    url: string;
    size: string;
    mime_type: string;
};

// Retired 'pending' 2026-07-26 (backlogs/sync-templates) in favor of a real website-provisioning
// lifecycle: 'creating-website' (org just created, real-estate only) -> 'ready' (website
// provisioned, or non-real-estate categories that skip provisioning entirely) -> 'active'
// (admin-approved) -> 'suspended'. 'website-failed' covers a CREATE_FAILED/ROLLBACK_COMPLETE
// stack. admin-api/'s copy of this type remains the source of truth for admin-governed
// transitions (active/suspended) — see docs/srs/admin-api-spec.md.
export type OrganisationStatus = 'creating-website' | 'ready' | 'website-failed' | 'active' | 'suspended';

// Launch markets for the real-estate vertical. See docs/api/market-behaviour.md.
export type Market = 'TH' | 'AU';

export const MARKET_CURRENCY: Record<Market, string> = {
    TH: 'THB',
    AU: 'AUD',
};

export type Organisation = {
    uuid: string;
    id: string;
    name: string;
    status: OrganisationStatus;
    image: Image | null;
    business_category: BusinessCategory;
    template_id: string;
    plan_id: string;
    created_at: string;
    description?: string;
    address: string | null;
    market: Market;
};

export type OrganisationRole = 'owner' | 'admin' | 'manager' | 'editor' | 'staff' | 'guest';

export type OrganisationUser = {
    role: OrganisationRole;
    position?: string;
    joined_date: string;
    phone?: string;
    bio?: string;
    timezone?: string;
    avatar?: Image | null;
    // Persisted display name (BR-32) — self-edited via PATCH /organisations/profile, same as
    // phone/bio/timezone/avatar. Distinct from the live Cognito `name` claim (`getUser(event).name`):
    // that's per-session and only ever known for the currently authenticated caller, never queryable
    // for an arbitrary team member — this field is what lets queries-api show an agent's name
    // publicly. GET /organisations/profile prefers this over the Cognito name once set.
    name?: string;
};

export type User = {
    status: 'unverified' | 'verified';
    profile: string;
};

// ─── Website branding ──────────────────────────
// One record per organisation. `name` is intentionally not part of this shape — it stays
// `Organisation.name`, edited live via the existing `PATCH /organisations` (no draft/publish needed for
// plain text). Website branding is the combination of `Organisation.name` (live) + this record's
// `data.{logo, primaryColor, secondaryColor}` (draft/publish controlled), combined at read time by the
// future queries API. Primary/secondary mirrors the `action.primary`/`action.secondary` semantic roles
// already in `theme-maker/*/design-system/semantic-tokens.ts` (brand vs. accent) — both are now
// client-editable hexes instead of only the primary/brand one.

export type BrandingColorScaleStep =
    | '50'
    | '100'
    | '200'
    | '300'
    | '400'
    | '500'
    | '600'
    | '700'
    | '800'
    | '900'
    | '950';

export type BrandingColorScale = Record<BrandingColorScaleStep, string>;

export type BrandingColor = {
    hex: string;
    scale: BrandingColorScale;
};

// Theme font — shared between an org's own branding record and template.ts's PredefinedTheme
// catalog entries (a predefined theme is a staff-curated color-palette + font combo).
export type ThemeFont = 'sans' | 'mono';

export type BrandingContent = {
    logo: Image | null;
    primaryColor: BrandingColor | null;
    secondaryColor: BrandingColor | null;
    font: ThemeFont | null;
};

export type BrandingRecord = {
    data: BrandingContent | null;
    draft: BrandingContent | null;
    updated_at: string;
    published_at: string | null;
};

// Same singleton-per-org, data/draft-split shape as BrandingContent/BrandingRecord above — see
// backlogs/testimonials/plan.md. Stat fields are display strings (e.g. "4.9/5", "8,500+", "24 h"),
// not numeric, matching the format the real-estate template's TestimonialsSlice already shows —
// deliberately not structured {value, unit} pairs for v1.
export type TestimonialItem = {
    name: string;
    testimonial: string;
};

export type TestimonialsContent = {
    averageRating: string;
    happyTenants: string;
    verifiedListings: string;
    avgResponseTime: string;
    testimonials: TestimonialItem[];
};

export type TestimonialsRecord = {
    data: TestimonialsContent | null;
    draft: TestimonialsContent | null;
    updated_at: string;
    published_at: string | null;
};

// Same singleton-per-org, data/draft-split shape as BrandingContent/TestimonialsContent above — see
// backlogs/home-thailand-estates-dynamic-about/plan.md. `blocks` is passed through unmodified: it's
// the `editor.document` array BlockNote (@blocknote/core) produces in web-app's About editor, stored
// and served as-is rather than re-modeled here (api/libs/shared has no BlockNote dependency). Only
// the fields the renderer actually needs to walk are typed; `props`/`content` stay structurally loose.
export type BlockNoteBlock = {
    id: string;
    type: string;
    props?: Record<string, unknown>;
    content?: unknown;
    children?: BlockNoteBlock[];
};

export type AboutPageContent = {
    blocks: BlockNoteBlock[];
};

export type AboutPageRecord = {
    data: AboutPageContent | null;
    draft: AboutPageContent | null;
    updated_at: string;
    published_at: string | null;
};

// Same singleton-per-org, data/draft-split shape as the records above — see
// backlogs/real-estate-template/children/home-thailand-estates-dynamic-locations/plan.md. Unlike
// About (one document), this holds a *list* of entries — closer to TestimonialsContent's repeater
// shape, except each entry also carries a BlockNote `body` (reusing BlockNoteBlock, same as
// AboutPageContent) for its own `/locations/<slug>` detail page. `slug` uniqueness is enforced by
// the write API, not the key structure — this is one DynamoDB item for the whole list, not one per
// location.
export type LocationItem = {
    slug: string;
    name: string;
    tagline: string;
    description: string; // short teaser shown on the /locations grid card, distinct from `body`
    label: string; // short badge text on the grid card image (e.g. "4,200+ properties") — free text,
    // not necessarily a property count — renamed from `propertyCount` 2026-09-04
    heroImage: string;
    body: BlockNoteBlock[]; // full BlockNote document, rendered on the /locations/<slug> detail page
};

export type LocationsContent = {
    locations: LocationItem[];
};

export type LocationsRecord = {
    data: LocationsContent | null;
    draft: LocationsContent | null;
    updated_at: string;
    published_at: string | null;
};

// Same singleton-per-org, data/draft-split shape as LocationsContent/LocationsRecord above — see
// backlogs/real-estate-template/children/home-thailand-estates-dynamic-articles/plan.md. Each entry
// carries its own BlockNote `body` (reusing BlockNoteBlock) for its own `/articles/<slug>` detail
// page. `slug` uniqueness is enforced by the write API, not the key structure — this is one
// DynamoDB item for the whole list, not one per article.
export type ArticleItem = {
    slug: string;
    title: string;
    category: string; // free text, e.g. "Guides", "Market Insights" — not a fixed enum
    readTime: string; // plain label, e.g. "6 min read" — not computed from body length
    excerpt: string; // short summary shown on the /articles grid card
    coverImage: string;
    body: BlockNoteBlock[]; // full BlockNote document, rendered on the /articles/<slug> detail page
};

export type ArticlesContent = {
    articles: ArticleItem[];
};

export type ArticlesRecord = {
    data: ArticlesContent | null;
    draft: ArticlesContent | null;
    updated_at: string;
    published_at: string | null;
};

// Same singleton-per-org, data/draft-split shape as LocationsContent/ArticlesContent above — see
// backlogs/real-estate-template/children/home-thailand-estates-dynamic-faq/plan.md. Unlike
// locations/articles, this is a **two-level** repeater (topics, each holding its own faqs) rather
// than a flat list, and there's no BlockNote body or slug anywhere here — no per-item detail page
// exists, the whole page is one client-side sidebar+accordion view over this one payload. `id` on
// both levels is a stable key for reorder/lookup, not a routable slug.
export type FaqEntry = {
    id: string;
    question: string;
    answer: string; // plain text — no rich formatting for now, see plan.md's open question
};

export type FaqTopic = {
    id: string;
    title: string; // e.g. "Buying Property", "Payments & Fees"
    faqs: FaqEntry[];
};

export type FaqContent = {
    topics: FaqTopic[];
};

export type FaqRecord = {
    data: FaqContent | null;
    draft: FaqContent | null;
    updated_at: string;
    published_at: string | null;
};
