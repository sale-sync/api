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
        font: ThemeFontSchema.optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field (primary_hex, secondary_hex, logo, font) must be provided',
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
});

export const UpdateLocationsDraftSchema = z
    .object({
        locations: z.array(LocationItemSchema).max(100, 'locations must be 100 items or fewer'),
    })
    .refine(
        (data) => {
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
});

export const UpdateArticlesDraftSchema = z
    .object({
        articles: z.array(ArticleItemSchema).max(200, 'articles must be 200 items or fewer'),
    })
    .refine(
        (data) => {
            const slugs = data.articles.map((a) => a.slug);
            return new Set(slugs).size === slugs.length;
        },
        { message: 'Each article must have a unique slug', path: ['articles'] },
    );

export type UpdateArticlesDraftInput = z.infer<typeof UpdateArticlesDraftSchema>;

// No slug here (unlike locations/articles) — nothing is routed by these ids, they're only stable
// keys for reorder/lookup in the editor, so ids are validated for uniqueness but not shaped like a
// URL segment.
export const FaqEntrySchema = z.object({
    id: z.string().trim().min(1, 'id is required').max(80, 'id must be 80 characters or fewer'),
    question: z.string().trim().min(1, 'question is required').max(300, 'question must be 300 characters or fewer'),
    answer: z.string().trim().min(1, 'answer is required').max(3000, 'answer must be 3000 characters or fewer'),
});

export const FaqTopicSchema = z.object({
    id: z.string().trim().min(1, 'id is required').max(80, 'id must be 80 characters or fewer'),
    title: z.string().trim().min(1, 'title is required').max(120, 'title must be 120 characters or fewer'),
    faqs: z.array(FaqEntrySchema).max(100, 'faqs must be 100 items or fewer'),
});

export const UpdateFaqDraftSchema = z
    .object({
        topics: z.array(FaqTopicSchema).max(50, 'topics must be 50 items or fewer'),
    })
    .refine(
        (data) => {
            const topicIds = data.topics.map((t) => t.id);
            return new Set(topicIds).size === topicIds.length;
        },
        { message: 'Each topic must have a unique id', path: ['topics'] },
    )
    .refine(
        (data) => {
            return data.topics.every((topic) => {
                const faqIds = topic.faqs.map((f) => f.id);
                return new Set(faqIds).size === faqIds.length;
            });
        },
        { message: 'Each FAQ within a topic must have a unique id', path: ['topics'] },
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
