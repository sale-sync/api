import { z } from 'zod';

export const CreateSubscriptionSchema = z.object({
    organisation_id: z.string().min(1, 'organisation_id is required'),
    plan_id: z.string().min(1, 'plan_id is required'),
    trial_start: z.string().min(1, 'trial_start is required'),
    trial_end: z.string().min(1, 'trial_end is required'),
});

export type CreateSubscriptionInput = z.infer<typeof CreateSubscriptionSchema>;

export const UpdateSubscriptionSchema = z.object({
    organisation_id: z.string().min(1, 'organisation_id is required'),
    plan_id: z.string().min(1).optional(),
    trial_end: z.string().min(1).optional(),
    status: z.enum(['trialing', 'active', 'past_due', 'canceled']).optional(),
    payment_method: z.enum(['bank_transfer', 'stripe']).nullable().optional(),
    activated_by: z.string().nullable().optional(),
    activated_at: z.string().nullable().optional(),
});

export type UpdateSubscriptionInput = z.infer<typeof UpdateSubscriptionSchema>;
