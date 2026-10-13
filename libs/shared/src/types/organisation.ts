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
    favicon: Image | null;
    primaryColor: BrandingColor | null;
    secondaryColor: BrandingColor | null;
    font: ThemeFont | null;
};

// Tracks the async infra/functions/publish-primitive-tokens Lambda that regenerates a deployed
// site's primitive-tokens.css after a publish — see backlogs/publish-render/children/publish-primitive-tokens.
// 'idle': never published (or nothing pending). 'generating': publish() just flipped draft -> data
// and fire-and-forget invoked the Lambda; the response returns before generation finishes.
// 'success'/'fail': set by the Lambda itself once it finishes. A 'fail' surfaces status_reason and
// is only cleared by a manual re-publish — there's no automatic retry.
export type BrandingGenerationStatus = 'idle' | 'generating' | 'success' | 'fail';

export type BrandingRecord = {
    data: BrandingContent | null;
    draft: BrandingContent | null;
    updated_at: string;
    published_at: string | null;
    status: BrandingGenerationStatus;
    status_reason: string | null;
};

// Same singleton-per-org, data/draft-split shape as BrandingContent/BrandingRecord above — see
// backlogs/testimonials/plan.md and backlogs/testimonials-revamp/plan.md. The four stat fields the
// first version carried (averageRating, happyTenants, verifiedListings, avgResponseTime) were removed
// 2026-10-11: records already stored still contain them, they are simply ignored and dropped on the
// org's next draft save.
export type TestimonialItem = {
    // Stable uuid so the web-app can route to one testimonial. Items stored before the revamp had none:
    // TestimonialsService.get() backfills it.
    id: string;
    name: string;
    testimonial: string;
    // Integer 1-5. Items stored before the revamp had none: TestimonialsService.get() backfills 5.
    rating: number;
};

export type TestimonialsContent = {
    testimonials: TestimonialItem[];
};

export type TestimonialsRecord = {
    data: TestimonialsContent | null;
    draft: TestimonialsContent | null;
    updated_at: string;
    published_at: string | null;
};

// Footer social links — see backlogs/footer-socials-ssr/plan.md. Same singleton-per-org, data/draft-split
// shape as TestimonialsContent above. SOCIAL_NETWORKS' order IS the footer's fixed icon order (not
// client-sortable). Every value is a full http(s) URL (LINE/WhatsApp included, e.g. https://wa.me/66812345678);
// an empty string means "not set" and the footer hides that icon.
export const SOCIAL_NETWORKS = ['facebook', 'instagram', 'line', 'whatsapp', 'youtube', 'tiktok', 'x'] as const;

export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

export type SocialsContent = Record<SocialNetwork, string>;

export type SocialsRecord = {
    data: SocialsContent | null;
    draft: SocialsContent | null;
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

// Per-page SEO override — mirrors theme-maker's own SEO type exactly (builder.ts), so
// infra/functions/publish-blocknote-singleton needs no translation between the two. All fields
// optional and independently overridable: a field left unset keeps the theme's static default
// (see pages/about.ts's own seo.title/description/image) rather than being blanked out.
export type SEO = {
    title?: string;
    description?: string;
    image?: string;
};

export type AboutPageContent = {
    blocks: BlockNoteBlock[];
    seo?: SEO;
};

export type AboutPageRecord = {
    data: AboutPageContent | null;
    draft: AboutPageContent | null;
    updated_at: string;
    published_at: string | null;
};

// Same singleton-per-org, data/draft-split shape as AboutPageContent/AboutPageRecord above — see
// backlogs/real-estate-template/children/home-thailand-estates-dynamic-privacy-policy/plan.md.
export type PrivacyPolicyContent = {
    blocks: BlockNoteBlock[];
    seo?: SEO;
};

export type PrivacyPolicyRecord = {
    data: PrivacyPolicyContent | null;
    draft: PrivacyPolicyContent | null;
    updated_at: string;
    published_at: string | null;
};

// Same singleton-per-org, data/draft-split shape as AboutPageContent/AboutPageRecord above — see
// backlogs/real-estate-template/children/home-thailand-estates-dynamic-terms-and-conditions/plan.md.
export type TermsAndConditionsContent = {
    blocks: BlockNoteBlock[];
    seo?: SEO;
};

export type TermsAndConditionsRecord = {
    data: TermsAndConditionsContent | null;
    draft: TermsAndConditionsContent | null;
    updated_at: string;
    published_at: string | null;
};

// The home page's only editable section — Featured Properties/Testimonials are live/CSR from
// queries-api, not org-authored content, so they have no place here. No BlockNoteBlock body: these
// are plain fields, unlike About/Privacy Policy/Terms & Conditions. See
// backlogs/real-estate-template/children/real-estate-home-page-hero/plan.md.
export type HeroContent = {
    badge: string;
    title: string;
    subtitle: string;
    bannerImage: string;
    // 0-1, darkness of the gradient overlay drawn over bannerImage (0 = no overlay, 1 = fully
    // opaque black). Optional because records published before this field existed have none stored;
    // the web-app editor shows/edits this as a 0-100% value and maps it to 0-1 here, and
    // publish-real-estate-home-page.ts falls back to 0.55 (HeroStyle's static default) when absent.
    overlayOpacity?: number;
};

export type HomePageContent = {
    hero: HeroContent;
    seo?: SEO;
};

// Same singleton-per-org, data/draft-split shape as AboutPageRecord above. Unlike About/Privacy
// Policy/Terms & Conditions, publishing this does not yet trigger any site regeneration —
// `real-estate-home-page` is `render: hybrid`, and its shell-regeneration mechanism is still an open
// question owned by `csr-hybrid-pages` (see that backlog's plan.md), not `publish-blocknote-singleton`
// (which only handles `render: ssr` pages).
export type HomePageRecord = {
    data: HomePageContent | null;
    draft: HomePageContent | null;
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
    // Per-location SEO override for its own /locations/<slug> detail page — added 2026-09-17, see
    // backlogs/real-estate-template/children/locations-page-ssr-split/children/
    // publish-location-detail-page. Independently optional per field, same convention as
    // ArticleItem.seo: unset means "use this location's own name/tagline/heroImage," not blanked out.
    seo?: SEO;
};

// The Locations listing page's editable Hero — added 2026-09-17, same shape as ArticlesHero
// (title/subtitle + bannerImage/overlayOpacity), see
// backlogs/real-estate-template/children/locations-page-ssr-split/children/locations-hero-content.
export type LocationsHero = {
    title: string;
    subtitle: string;
    bannerImage: string;
    // 0-1, optional — same rationale as HeroContent.overlayOpacity/ArticlesHero.overlayOpacity
    // (records saved before this field existed have none stored; the generator falls back to 0.55).
    overlayOpacity?: number;
};

// `hero`/`seo` are independently optional and independently updatable — LocationsService.updateDraft()
// merges each field from the existing draft when omitted, same rationale/bug-avoidance as
// ArticlesContent's own comment: LocationComp's per-location save already PATCHes just
// `{ locations }`, so a naive full-replace here would silently wipe out a separately-saved Hero/SEO.
export type LocationsContent = {
    locations: LocationItem[];
    hero?: LocationsHero;
    seo?: SEO;
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
    // Per-article SEO override for its own /articles/<slug> detail page — added 2026-09-15, see
    // backlogs/real-estate-template/children/articles-page-ssr-split/children/
    // publish-article-detail-page. Independently optional per field, same convention as every other
    // page's SEO: unset means "use this article's own title/excerpt/coverImage," not blanked out.
    seo?: SEO;
};

// The Articles listing page's editable Hero — added 2026-09-15 (title/subtitle only at first), then
// extended same-day to add bannerImage/overlayOpacity for parity with Agents' banner — see
// backlogs/real-estate-template/children/articles-page-ssr-split/children/articles-hero-content.
export type ArticlesHero = {
    title: string;
    subtitle: string;
    bannerImage: string;
    // 0-1, optional — same rationale as HeroContent.overlayOpacity (records saved before this field
    // existed have none stored; the generator falls back to 0.55).
    overlayOpacity?: number;
};

// `hero`/`seo` are independently optional and independently updatable — `ArticlesService.updateDraft()`
// merges each field from the existing draft when omitted from a PATCH, rather than requiring every
// caller to resend the whole record. This matters because `ArticleForm.tsx` (web-app) already PATCHes
// just `{ articles }` on every single-article save — a naive full-replace here would silently wipe
// out `hero`/`seo` on every article add/edit, which is exactly the bug this merge behavior avoids.
export type ArticlesContent = {
    articles: ArticleItem[];
    hero?: ArticlesHero;
    seo?: SEO;
};

export type ArticlesRecord = {
    data: ArticlesContent | null;
    draft: ArticlesContent | null;
    updated_at: string;
    published_at: string | null;
};

// Same singleton-per-org, data/draft-split shape as LocationsContent/ArticlesContent above — see
// backlogs/real-estate-template/children/home-thailand-estates-dynamic-faq/plan.md. There's no
// BlockNote body or slug anywhere here — no per-item detail page exists, the whole page is one
// client-side sidebar+accordion view over this one payload. `id` on both levels is a stable key for
// reorder/lookup, not a routable slug.
//
// Many-to-many relationship (added 2026-09-17, client feedback — see backlogs/
// real-estate-template/children/faq-many-to-many-topics): originally a **two-level** repeater
// (topics, each holding its own embedded `faqs`), changed to two flat, related top-level lists — a
// Topic can have multiple FAQs and an FAQ can belong to multiple Topics. The join lives on the FAQ
// side (`FaqEntry.topicIds`), not a separate junction structure, since this is still one singleton
// per-org record. `topicIds` is deliberately NOT required to be non-empty at this type/schema level
// — see `UpdateFaqDraftSchema`'s own comment for why (the topic-delete cascade needs to legitimately
// write an empty array here; "at least one topic" is a web-app form-level rule instead). No
// backward-compat normalization for the old nested shape — confirmed 2026-09-17 there is no live
// FAQ data yet to migrate.
export type FaqEntry = {
    id: string;
    question: string;
    answer: string; // plain text — no rich formatting for now, see plan.md's open question
    topicIds: string[];
};

export type FaqTopic = {
    id: string;
    title: string; // e.g. "Buying Property", "Payments & Fees"
};

// The FAQ page's editable Hero — added 2026-09-17 (backlogs/real-estate-template/children/
// faq-page-hero), same shape as ArticlesHero/LocationsHero exactly. Independently optional and
// independently updatable alongside `topics`/`faqs` — see FaqContent's own comment below.
export type FaqHero = {
    title: string;
    subtitle: string;
    bannerImage: string;
    // 0-1, optional — same rationale as HeroContent.overlayOpacity (records saved before this field
    // existed have none stored; the generator falls back to 0.55).
    overlayOpacity?: number;
};

// `topics`/`faqs`/`hero`/`seo` are all independently optional and independently updatable —
// FaqService.updateDraft() merges each field from the existing draft when omitted, so the Topics
// editor can PATCH just `{ topics }`, the Questions editor just `{ faqs }`, and the Hero/SEO editor
// just `{ hero, seo }`, without any of them wiping out the others. Same convention
// ArticlesContent's hero/seo-vs-articles merge established.
export type FaqContent = {
    topics: FaqTopic[];
    faqs: FaqEntry[];
    hero?: FaqHero;
    seo?: SEO;
};

export type FaqRecord = {
    data: FaqContent | null;
    draft: FaqContent | null;
    updated_at: string;
    published_at: string | null;
};

// The Contact page's editable content — added 2026-10-11 (backlogs/contact-page). Shared by every
// business category (pageCategory 'normal'). No hero/banner: just a heading (title + subtitle), the
// Business Information card and page SEO. Socials are deliberately NOT stored here — the page reuses
// the org's footer socials (SocialsRecord), baked by the same footer pass as every other page.
// The phone country code is not stored either: the generator derives it from `Organisation.market`.
export type ContactBusinessInfo = {
    email: string;
    phone: string;
    address: string;
};

// `title`/`subtitle`/`businessInfo`/`seo` are all independently optional and independently
// updatable — ContactService.updateDraft() merges each field from the existing draft when omitted.
export type ContactContent = {
    title?: string;
    subtitle?: string;
    businessInfo?: ContactBusinessInfo;
    seo?: SEO;
};

export type ContactRecord = {
    data: ContactContent | null;
    draft: ContactContent | null;
    updated_at: string;
    published_at: string | null;
};

// The Agents page's editable section — title/subtitle + banner image/opacity, same fields as Home's
// Hero minus `badge` (added 2026-09-15 after Home's own title/subtitle pattern, following a smoke
// test). See backlogs/real-estate-template/children/real-estate-agents-page-banner/plan.md.
export type AgentsBanner = {
    title: string;
    subtitle: string;
    bannerImage: string;
    // 0-1, optional — same rationale as HeroContent.overlayOpacity (records published before this
    // field existed have none stored; the generator falls back to 0.55).
    overlayOpacity?: number;
};

export type AgentsPageContent = {
    banner: AgentsBanner;
    seo?: SEO;
};

// Same singleton-per-org, data/draft-split shape as HomePageRecord above. SK=AGENTS_PAGE — confirmed
// no collision with the existing per-item agent-profile feature (SK=AGENT#{agentId}, a completely
// different feature: staff/team members, not this page's banner).
export type AgentsPageRecord = {
    data: AgentsPageContent | null;
    draft: AgentsPageContent | null;
    updated_at: string;
    published_at: string | null;
};

// The Map View page's only editable content is its SEO — the page itself is 100% CSR (one
// fullscreen PropertyMapViewSlice, no Hero), so publish-real-estate-map-view-page only ever patches
// <head>. Same singleton-per-org, data/draft-split shape as AgentsPageRecord above. SK=MAP_VIEW. See
// backlogs/real-estate-template/children/real-estate-map-view-seo.
export type MapViewContent = {
    seo?: SEO;
};

export type MapViewRecord = {
    data: MapViewContent | null;
    draft: MapViewContent | null;
    updated_at: string;
    published_at: string | null;
};

// The Properties page's editable Hero — same title/subtitle/bannerImage/overlayOpacity shape as
// FaqHero/ArticlesHero/LocationsHero. The filter panel + results grid below it stay pure CSR. See
// backlogs/real-estate-template/children/real-estate-properties-page-hero.
export type PropertiesPageHero = {
    title: string;
    subtitle: string;
    bannerImage: string;
    // 0-1, optional — same rationale as HeroContent.overlayOpacity.
    overlayOpacity?: number;
};

export type PropertiesPageContent = {
    hero: PropertiesPageHero;
    seo?: SEO;
};

// Same singleton-per-org, data/draft-split shape as AgentsPageRecord above. SK=PROPERTIES_PAGE — the
// property listings themselves live in a different table (PropertyTable, SK=PROPERTY#<uuid>).
export type PropertiesPageRecord = {
    data: PropertiesPageContent | null;
    draft: PropertiesPageContent | null;
    updated_at: string;
    published_at: string | null;
};

// Publish completion status. Publishing a page flips draft -> data and fire-and-forgets a generator
// Lambda in ss/infra, so the POST returns before anything is baked to S3. To let the client tell when
// the bake actually finished, each publish also writes one status item per org per page
// (PK=ORG#{orgUuid}, SK=PUBLISH_STATUS#{pageKey}) into the ORGANISATION table, and each generator
// reports its own result into that item's `results` map. Branding is excluded: it has its own
// status lifecycle (BrandingRecord.status).
export const PUBLISH_STATUS_KEYS = [
    'home',
    'agents',
    'map-view',
    'properties',
    'about',
    'privacy-policy',
    'terms-and-conditions',
    'articles',
    'locations',
    'faq',
    'contact',
    'socials',
] as const;

export type PublishStatusKey = (typeof PUBLISH_STATUS_KEYS)[number];

export type PublishStatus = 'idle' | 'generating' | 'success' | 'fail';

export type PublishJobResult = {
    ok: boolean;
    reason?: string;
    finished_at: string;
};

// The stored item shape. Native attributes (not a JSON `data` string) so a generator can UpdateItem a
// single `results.<generatorName>` key without a read-modify-write race.
export type PublishStatusItem = {
    publish_id: string;
    page: PublishStatusKey;
    expected: string[];
    results: Record<string, PublishJobResult>;
    started_at: string;
};

export type PublishStatusResponse = {
    page: PublishStatusKey;
    publish_id: string | null;
    status: PublishStatus;
    expected: string[];
    results: Record<string, PublishJobResult>;
    reason: string | null;
    started_at: string | null;
};
