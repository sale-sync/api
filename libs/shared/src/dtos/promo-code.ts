import { z } from 'zod';

export const PromoCodeTypeSchema = z.enum(['percentage', 'flat_amount', 'trial_extension_days']);

export const CreatePromoCodeSchema = z
    .object({
        code: z
            .string()
            .min(1, 'code is required')
            .regex(/^[A-Za-z0-9_-]+$/, 'code may only contain letters, numbers, hyphens, and underscores'),
        type: PromoCodeTypeSchema,
        value: z.number().positive('value must be greater than 0'),
        max_redemptions: z.number().int().positive().nullable().optional(),
        expires_at: z.string().nullable().optional(),
        created_by: z.string().min(1, 'created_by is required'),
    })
    .refine((data) => data.type !== 'percentage' || data.value <= 100, {
        message: 'value must be between 0 and 100 for a percentage code',
        path: ['value'],
    })
    .refine((data) => data.type !== 'trial_extension_days' || Number.isInteger(data.value), {
        message: 'value must be a whole number of days for a trial-extension code',
        path: ['value'],
    });

export type CreatePromoCodeInput = z.infer<typeof CreatePromoCodeSchema>;

export const UpdatePromoCodeSchema = z.object({
    uuid: z.string().uuid('uuid must be a valid UUID'),
    status: z.enum(['active', 'disabled']).optional(),
    max_redemptions: z.number().int().positive().nullable().optional(),
    expires_at: z.string().nullable().optional(),
});

export type UpdatePromoCodeInput = z.infer<typeof UpdatePromoCodeSchema>;
