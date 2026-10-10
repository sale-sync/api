import { z } from 'zod';

const BusinessCategorySchema = z.enum([
    'fitness',
    'real-estate',
    'service-business',
    'restaurant',
    'haircut-and-salon',
]);

export const MarketSchema = z.enum(['TH', 'AU']);

export const ImageSchema = z.object({
    name: z.string(),
    url: z.string(),
    size: z.string(),
    mime_type: z.string(),
});

export const CreateOrganisationSchema = z.object({
    organisation_id: z.string().min(1, 'organisation_id is required'),
    organisation_name: z.string().min(1, 'organisation_name is required'),
    business_category: BusinessCategorySchema,
    template_id: z.string().uuid(),
    plan_id: z.string().uuid(),
    description: z.string().optional(),
    address: z.string().optional(),
    market: MarketSchema.default('AU'),
});

export type CreateOrganisationInput = z.infer<typeof CreateOrganisationSchema>;

export const UpdateOrganisationSchema = z
    .object({
        name: z.string().min(1, 'name must not be empty').optional(),
        description: z.string().optional(),
        address: z.string().nullable().optional(),
        image: ImageSchema.nullable().optional(),
        market: MarketSchema.optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field (name, description, address, image, market) must be provided',
    });

export type UpdateOrganisationInput = z.infer<typeof UpdateOrganisationSchema>;

export const AddTeamMemberSchema = z.object({
    email: z.union([
        z.string().email('email must be a valid email address'),
        z.array(z.string().email('each email must be a valid email address')).min(1, 'email array must not be empty'),
    ]),
});

export type AddTeamMemberInput = z.infer<typeof AddTeamMemberSchema>;

export const AddTeamMemberByUserIdSchema = z.object({
    user_id: z.union([
        z.string().min(1, 'user_id is required'),
        z.array(z.string().min(1, 'each user_id is required')).min(1, 'user_id array must not be empty'),
    ]),
});

export type AddTeamMemberByUserIdInput = z.infer<typeof AddTeamMemberByUserIdSchema>;

export const RemoveTeamMemberSchema = z.object({
    user_id: z.string().min(1, 'user_id is required'),
});

export type RemoveTeamMemberInput = z.infer<typeof RemoveTeamMemberSchema>;

export const UpdateTeamMemberRoleSchema = z.object({
    user_id: z.string().min(1, 'user_id is required'),
    role: z.enum(['owner', 'admin', 'manager', 'editor', 'staff', 'guest']),
});

export type UpdateTeamMemberRoleInput = z.infer<typeof UpdateTeamMemberRoleSchema>;

export const UpdateProfileSchema = z
    .object({
        name: z.string().optional(),
        phone: z.string().optional(),
        bio: z.string().optional(),
        timezone: z.string().optional(),
        avatar: ImageSchema.nullable().optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field (name, phone, bio, timezone, avatar) must be provided',
    });

export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;

export const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const ThemeFontSchema = z.enum(['sans', 'mono']);

export const UpdateBrandingDraftSchema = z
    .object({
        primary_hex: z
            .string()
            .regex(HEX_COLOR_REGEX, 'primary_hex must be a valid hex color (e.g. #D60002)')
            .optional(),
        secondary_hex: z
            .string()
            .regex(HEX_COLOR_REGEX, 'secondary_hex must be a valid hex color (e.g. #3C53FF)')
            .optional(),
        logo: ImageSchema.nullable().optional(),
        favicon: ImageSchema.nullable().optional(),
        font: ThemeFontSchema.optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field (primary_hex, secondary_hex, logo, favicon, font) must be provided',
    });

export type UpdateBrandingDraftInput = z.infer<typeof UpdateBrandingDraftSchema>;

export const TestimonialItemSchema = z.object({
    name: z.string().trim().min(1, 'name is required').max(120, 'name must be 120 characters or fewer'),
    testimonial: z
        .string()
        .trim()
        .min(1, 'testimonial is required')
        .max(1000, 'testimonial must be 1000 characters or fewer'),
});

export const UpdateTestimonialsDraftSchema = z
    .object({
        averageRating: z.string().trim().min(1).max(40).optional(),
        happyTenants: z.string().trim().min(1).max(40).optional(),
        verifiedListings: z.string().trim().min(1).max(40).optional(),
        avgResponseTime: z.string().trim().min(1).max(40).optional(),
        testimonials: z.array(TestimonialItemSchema).max(50, 'testimonials must be 50 items or fewer').optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
        message:
            'At least one field (averageRating, happyTenants, verifiedListings, avgResponseTime, testimonials) must be provided',
    });

export type UpdateTestimonialsDraftInput = z.infer<typeof UpdateTestimonialsDraftSchema>;

// A social link is baked into a public page's href by the page generators, so only http(s) URLs are
// accepted (never javascript:/data: etc.). Empty string clears the field.
const SocialUrlSchema = z
    .string()
    .trim()
    .max(2048, 'url must be 2048 characters or fewer')
    .refine(
        (value) => {
            if (value.length === 0) return true;
            try {
                const { protocol } = new URL(value);
                return protocol === 'https:' || protocol === 'http:';
            } catch {
                return false;
            }
        },
        { message: 'Enter a valid http(s) URL, or leave empty to remove' },
    );

export const UpdateSocialsDraftSchema = z
    .object({
        facebook: SocialUrlSchema.optional(),
        instagram: SocialUrlSchema.optional(),
        line: SocialUrlSchema.optional(),
        whatsapp: SocialUrlSchema.optional(),
        youtube: SocialUrlSchema.optional(),
        tiktok: SocialUrlSchema.optional(),
        x: SocialUrlSchema.optional(),
    })
    .strict()
    .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field (facebook, instagram, line, whatsapp, youtube, tiktok, x) must be provided',
    });

export type UpdateSocialsDraftInput = z.infer<typeof UpdateSocialsDraftSchema>;

// Structural validation only — mirrors BlockNoteBlock in types/organisation.ts. Deliberately doesn't
// enumerate BlockNote's actual block-type union (paragraph/heading/bulletListItem/...) since that
// schema lives in @blocknote/core, not here; this just confirms the shape is a well-formed block
// tree before it's persisted, same lenient stance samjs takes elsewhere for editor-authored JSON.
type BlockNoteBlockShape = {
    id: string;
    type: string;
    props?: Record<string, unknown>;
    content?: unknown;
    children?: BlockNoteBlockShape[];
};

const BlockNoteBlockSchema: z.ZodType<BlockNoteBlockShape> = z.lazy(() =>
    z.object({
        id: z.string(),
        type: z.string(),
        props: z.record(z.string(), z.unknown()).optional(),
        content: z.unknown().optional(),
        children: z.array(BlockNoteBlockSchema).optional(),
    }),
);

// Per-page SEO override — see SEO in ../types/organisation.ts for the field-by-field rationale.
// Length caps loosely match common search-engine truncation points (title ~60 chars, description
// ~160 chars before a search result snippet gets cut off) with headroom, not a hard technical limit.
export const SEOSchema = z.object({
    title: z.string().trim().max(100, 'title must be 100 characters or fewer').optional(),
    description: z.string().trim().max(300, 'description must be 300 characters or fewer').optional(),
    image: z.string().trim().optional(),
});

export const UpdateAboutDraftSchema = z.object({
    blocks: z.array(BlockNoteBlockSchema).max(500, 'blocks must be 500 items or fewer'),
    seo: SEOSchema.optional(),
});

export type UpdateAboutDraftInput = z.infer<typeof UpdateAboutDraftSchema>;

// Same singleton-document shape as UpdateAboutDraftSchema above.
export const UpdatePrivacyPolicyDraftSchema = z.object({
    blocks: z.array(BlockNoteBlockSchema).max(500, 'blocks must be 500 items or fewer'),
    seo: SEOSchema.optional(),
});

export type UpdatePrivacyPolicyDraftInput = z.infer<typeof UpdatePrivacyPolicyDraftSchema>;

// Same singleton-document shape as UpdateAboutDraftSchema above.
export const UpdateTermsAndConditionsDraftSchema = z.object({
    blocks: z.array(BlockNoteBlockSchema).max(500, 'blocks must be 500 items or fewer'),
    seo: SEOSchema.optional(),
});

export type UpdateTermsAndConditionsDraftInput = z.infer<typeof UpdateTermsAndConditionsDraftSchema>;

// 100 chars matches the web-app editor's badge field limit (short eyebrow text — see
// backlogs/real-estate-template/children/real-estate-home-page-hero/plan.md). title/subtitle are
// plain multi-line strings (rendered `\n` handling is the renderer's concern, not validated here),
// capped generously since they're free text, not a single-line label like badge.
export const HeroContentSchema = z.object({
    badge: z.string().trim().max(100, 'badge must be 100 characters or fewer'),
    title: z.string().trim().max(200, 'title must be 200 characters or fewer'),
    subtitle: z.string().trim().max(400, 'subtitle must be 400 characters or fewer'),
    bannerImage: z.string().trim(),
    // 0-1 — see HeroContent's own comment (types/organisation.ts) for why this stays optional.
    overlayOpacity: z.number().min(0).max(1).optional(),
});

export const UpdateHomePageDraftSchema = z.object({
    hero: HeroContentSchema,
    seo: SEOSchema.optional(),
});

export type UpdateHomePageDraftInput = z.infer<typeof UpdateHomePageDraftSchema>;

// Agents page's editable section — same title/subtitle limits as HeroContentSchema, no `badge`.
export const AgentsBannerSchema = z.object({
    title: z.string().trim().max(200, 'title must be 200 characters or fewer'),
    subtitle: z.string().trim().max(400, 'subtitle must be 400 characters or fewer'),
    bannerImage: z.string().trim(),
    // 0-1 — see AgentsBanner's own comment (types/organisation.ts) for why this stays optional.
    overlayOpacity: z.number().min(0).max(1).optional(),
});

export const UpdateAgentsPageDraftSchema = z.object({
    banner: AgentsBannerSchema,
    seo: SEOSchema.optional(),
});

export type UpdateAgentsPageDraftInput = z.infer<typeof UpdateAgentsPageDraftSchema>;

// Map View page: SEO only, no Hero. `seo` is required here (unlike the other drafts, where it rides
// along optionally) since it's the page's entire content.
export const UpdateMapViewDraftSchema = z.object({
    seo: SEOSchema,
});

export type UpdateMapViewDraftInput = z.infer<typeof UpdateMapViewDraftSchema>;

// Same title/subtitle/bannerImage/overlayOpacity limits as AgentsBannerSchema's.
export const PropertiesPageHeroSchema = z.object({
    title: z.string().trim().max(200, 'title must be 200 characters or fewer'),
    subtitle: z.string().trim().max(400, 'subtitle must be 400 characters or fewer'),
    bannerImage: z.string().trim(),
    // 0-1 — see PropertiesPageHero's own comment (types/organisation.ts) for why this stays optional.
    overlayOpacity: z.number().min(0).max(1).optional(),
});

export const UpdatePropertiesPageDraftSchema = z.object({
    hero: PropertiesPageHeroSchema,
    seo: SEOSchema.optional(),
});

export type UpdatePropertiesPageDraftInput = z.infer<typeof UpdatePropertiesPageDraftSchema>;

// Slugs are used verbatim in the client site's /locations/<slug> URL — lowercase kebab-case only, no
// leading/trailing/double hyphens, so a saved slug is always a safe, predictable path segment.
export const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const LocationItemSchema = z.object({
    slug: z
        .string()
        .trim()
        .min(1, 'slug is required')
        .max(80, 'slug must be 80 characters or fewer')
        .regex(SLUG_REGEX, 'slug must be lowercase kebab-case (e.g. "bangkok", "koh-samui")'),
    name: z.string().trim().min(1, 'name is required').max(120, 'name must be 120 characters or fewer'),
    tagline: z.string().trim().max(160, 'tagline must be 160 characters or fewer'),
    description: z.string().trim().max(500, 'description must be 500 characters or fewer'),
    label: z.string().trim().max(40, 'label must be 40 characters or fewer'),
    heroImage: z.string().trim(),
    body: z.array(BlockNoteBlockSchema).max(500, 'body must be 500 blocks or fewer'),
    // Per-location SEO override for its own detail page — see LocationItem's own comment
    // (types/organisation.ts).
    seo: SEOSchema.optional(),
});

// Same title/subtitle/bannerImage/overlayOpacity limits as ArticlesHeroSchema's.
export const LocationsHeroSchema = z.object({
    title: z.string().trim().max(200, 'title must be 200 characters or fewer'),
    subtitle: z.string().trim().max(400, 'subtitle must be 400 characters or fewer'),
    bannerImage: z.string().trim(),
    // 0-1 — see LocationsHero's own comment (types/organisation.ts) for why this stays optional.
    overlayOpacity: z.number().min(0).max(1).optional(),
});

// `locations`/`hero`/`seo` are all independently optional here — LocationsService.updateDraft()
// merges each field from the existing draft when omitted, same convention as
// UpdateArticlesDraftSchema, so a PATCH can update just one of the three without resending the
// others. The slug-uniqueness refine only runs when `locations` is actually present in this
// particular request.
export const UpdateLocationsDraftSchema = z
    .object({
        locations: z.array(LocationItemSchema).max(100, 'locations must be 100 items or fewer').optional(),
        hero: LocationsHeroSchema.optional(),
        seo: SEOSchema.optional(),
    })
    .refine(
        (data) => {
            if (!data.locations) return true;
            const slugs = data.locations.map((l) => l.slug);
            return new Set(slugs).size === slugs.length;
        },
        { message: 'Each location must have a unique slug', path: ['locations'] },
    );

export type UpdateLocationsDraftInput = z.infer<typeof UpdateLocationsDraftSchema>;

// Slugs are used verbatim in the client site's /articles/<slug> URL — same constraint as
// LocationItemSchema's slug above.
export const ArticleItemSchema = z.object({
    slug: z
        .string()
        .trim()
        .min(1, 'slug is required')
        .max(80, 'slug must be 80 characters or fewer')
        .regex(SLUG_REGEX, 'slug must be lowercase kebab-case (e.g. "bangkok-rental-market-update")'),
    title: z.string().trim().min(1, 'title is required').max(160, 'title must be 160 characters or fewer'),
    category: z.string().trim().max(60, 'category must be 60 characters or fewer'),
    readTime: z.string().trim().max(40, 'readTime must be 40 characters or fewer'),
    excerpt: z.string().trim().max(500, 'excerpt must be 500 characters or fewer'),
    coverImage: z.string().trim(),
    body: z.array(BlockNoteBlockSchema).max(500, 'body must be 500 blocks or fewer'),
    // Per-article SEO override for its own detail page — see ArticleItem's own comment
    // (types/organisation.ts).
    seo: SEOSchema.optional(),
});

// Same title/subtitle limits as HeroContentSchema's.
export const ArticlesHeroSchema = z.object({
    title: z.string().trim().max(200, 'title must be 200 characters or fewer'),
    subtitle: z.string().trim().max(400, 'subtitle must be 400 characters or fewer'),
    bannerImage: z.string().trim(),
    // 0-1 — see ArticlesHero's own comment (types/organisation.ts) for why this stays optional.
    overlayOpacity: z.number().min(0).max(1).optional(),
});

// `articles`/`hero`/`seo` are all independently optional here — ArticlesService.updateDraft() merges
// each field from the existing draft when omitted, so a PATCH can update just one of the three
// without resending the others. The slug-uniqueness refine only runs when `articles` is actually
// present in this particular request.
export const UpdateArticlesDraftSchema = z
    .object({
        articles: z.array(ArticleItemSchema).max(200, 'articles must be 200 items or fewer').optional(),
        hero: ArticlesHeroSchema.optional(),
        seo: SEOSchema.optional(),
    })
    .refine(
        (data) => {
            if (!data.articles) return true;
            const slugs = data.articles.map((a) => a.slug);
            return new Set(slugs).size === slugs.length;
        },
        { message: 'Each article must have a unique slug', path: ['articles'] },
    );

export type UpdateArticlesDraftInput = z.infer<typeof UpdateArticlesDraftSchema>;

// No slug here (unlike locations/articles) — nothing is routed by these ids, they're only stable
// keys for reorder/lookup in the editor, so ids are validated for uniqueness but not shaped like a
// URL segment.
//
// `topicIds` is deliberately NOT `.min(1)` here — see FaqEntry's own comment (types/organisation.ts)
// for why: the topic-delete cascade needs to write an empty array through this same schema when a
// topic is deleted out from under an FAQ's only assignment. "At least one topic" is a web-app
// form-level validation on the FAQ create/edit form, not a schema-level invariant.
export const FaqEntrySchema = z.object({
    id: z.string().trim().min(1, 'id is required').max(80, 'id must be 80 characters or fewer'),
    question: z.string().trim().min(1, 'question is required').max(300, 'question must be 300 characters or fewer'),
    answer: z.string().trim().min(1, 'answer is required').max(3000, 'answer must be 3000 characters or fewer'),
    topicIds: z.array(z.string()).max(50, 'topicIds must be 50 items or fewer'),
});

export const FaqTopicSchema = z.object({
    id: z.string().trim().min(1, 'id is required').max(80, 'id must be 80 characters or fewer'),
    title: z.string().trim().min(1, 'title is required').max(120, 'title must be 120 characters or fewer'),
});

// The FAQ page's editable Hero — added 2026-09-17 (backlogs/real-estate-template/children/
// faq-page-hero). Same title/subtitle/bannerImage/overlayOpacity limits as ArticlesHeroSchema's.
export const FaqHeroSchema = z.object({
    title: z.string().trim().max(200, 'title must be 200 characters or fewer'),
    subtitle: z.string().trim().max(400, 'subtitle must be 400 characters or fewer'),
    bannerImage: z.string().trim(),
    overlayOpacity: z.number().min(0).max(1).optional(),
});

// `topics`/`faqs`/`hero`/`seo` are all independently optional here, same merge convention as
// UpdateArticlesDraftSchema's `articles`/`hero`/`seo` — FaqService.updateDraft() merges each field
// from the existing draft when omitted, so the Topic editor can PATCH just `{ topics }`, the FAQ
// editor just `{ faqs }`, and the Hero/SEO editor just `{ hero, seo }`, without any of them wiping
// out the others.
//
// The faq-id-uniqueness refine is now GLOBAL across `faqs[]` (previously only checked within one
// topic's own embedded list, since nesting made cross-topic collisions impossible). The
// topicId-referential-integrity refine (every `faqs[].topicIds` entry must name a real topic) only
// runs when BOTH `topics` and `faqs` are present in the same request — a request that only patches
// one side can't validate against the other without a DB read, and every normal UI flow (the FAQ
// form's Topics multi-select is populated from the currently-loaded real topic list, and the
// topic-delete cascade always sends both `topics` and `faqs` together) never actually needs to.
export const UpdateFaqDraftSchema = z
    .object({
        topics: z.array(FaqTopicSchema).max(50, 'topics must be 50 items or fewer').optional(),
        faqs: z.array(FaqEntrySchema).max(500, 'faqs must be 500 items or fewer').optional(),
        hero: FaqHeroSchema.optional(),
        seo: SEOSchema.optional(),
    })
    .refine(
        (data) => {
            if (!data.topics) return true;
            const topicIds = data.topics.map((t) => t.id);
            return new Set(topicIds).size === topicIds.length;
        },
        { message: 'Each topic must have a unique id', path: ['topics'] },
    )
    .refine(
        (data) => {
            if (!data.faqs) return true;
            const faqIds = data.faqs.map((f) => f.id);
            return new Set(faqIds).size === faqIds.length;
        },
        { message: 'Each FAQ must have a unique id', path: ['faqs'] },
    )
    .refine(
        (data) => {
            if (!data.topics || !data.faqs) return true;
            const validTopicIds = new Set(data.topics.map((t) => t.id));
            return data.faqs.every((faq) => faq.topicIds.every((id) => validTopicIds.has(id)));
        },
        { message: 'Each FAQ can only reference topics included in this request', path: ['faqs'] },
    );

export type UpdateFaqDraftInput = z.infer<typeof UpdateFaqDraftSchema>;

// ─── Admin-only ──────────────────────────
// Staff-side org update: status/plan reassignment only — deliberately a separate schema from
// UpdateOrganisationSchema above (customer self-edit: name/description/address/image/market).
// The two never overlap in allowed fields, so they stay distinct rather than one combined schema.
export const AdminUpdateOrganisationSchema = z.object({
    uuid: z.string().uuid('uuid must be a valid UUID'),
    status: z.enum(['creating-website', 'ready', 'website-failed', 'active', 'suspended']).optional(),
    plan_id: z.string().uuid('plan_id must be a valid UUID').optional(),
});

export type AdminUpdateOrganisationInput = z.infer<typeof AdminUpdateOrganisationSchema>;
