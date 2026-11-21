import { z } from 'zod';

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
