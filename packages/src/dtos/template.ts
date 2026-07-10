import { z } from 'zod';

const BusinessCategorySchema = z.enum(['fitness', 'real-estate', 'service-business', 'restaurant', 'haircut-and-salon']);
const ThemeBrandColorSchema = z.enum(['red', 'orange', 'blue', 'purple', 'green', 'amber', 'gray', 'stone']);
const ThemeFontSchema = z.enum(['sans', 'mono']);

export const CreateTemplateSchema = z.object({
    name: z.string().min(1, 'name is required'),
    business_category: BusinessCategorySchema,
    preview_image: z.string().min(1, 'preview_image is required'),
});

export type CreateTemplateInput = z.infer<typeof CreateTemplateSchema>;

export const AddTemplateSchema = z.object({
    template_uuid: z.string().uuid(),
    set_active: z.boolean().optional(),
});

export type AddTemplateInput = z.infer<typeof AddTemplateSchema>;

export const RemoveTemplateSchema = z.object({
    template_uuid: z.string().uuid(),
});

export type RemoveTemplateInput = z.infer<typeof RemoveTemplateSchema>;

export const SetActiveTemplateSchema = z.object({
    template_uuid: z.string().uuid(),
});

export type SetActiveTemplateInput = z.infer<typeof SetActiveTemplateSchema>;

export const UpdateThemeSchema = z.object({
    template_uuid: z.string().uuid(),
    brand_color: ThemeBrandColorSchema.optional(),
    font: ThemeFontSchema.optional(),
});

export type UpdateThemeInput = z.infer<typeof UpdateThemeSchema>;
