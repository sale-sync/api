import { z } from 'zod';

const ThemeBrandColorSchema = z.enum(['red', 'orange', 'blue', 'purple', 'green', 'amber', 'gray', 'stone']);
const ThemeFontSchema = z.enum(['sans', 'mono']);

export const AddTemplateSchema = z.object({
    org_uuid: z.string().uuid(),
    template_uuid: z.string().uuid(),
    set_active: z.boolean().optional(),
});

export type AddTemplateInput = z.infer<typeof AddTemplateSchema>;

export const RemoveTemplateSchema = z.object({
    org_uuid: z.string().uuid(),
    template_uuid: z.string().uuid(),
});

export type RemoveTemplateInput = z.infer<typeof RemoveTemplateSchema>;

export const SetActiveTemplateSchema = z.object({
    org_uuid: z.string().uuid(),
    template_uuid: z.string().uuid(),
});

export type SetActiveTemplateInput = z.infer<typeof SetActiveTemplateSchema>;

export const UpdateThemeSchema = z.object({
    org_uuid: z.string().uuid(),
    template_uuid: z.string().uuid(),
    brand_color: ThemeBrandColorSchema.optional(),
    font: ThemeFontSchema.optional(),
});

export type UpdateThemeInput = z.infer<typeof UpdateThemeSchema>;
