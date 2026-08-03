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
    promo_code: z.string().optional(),
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
        phone: z.string().optional(),
        bio: z.string().optional(),
        timezone: z.string().optional(),
        avatar: ImageSchema.nullable().optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field (phone, bio, timezone, avatar) must be provided',
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
