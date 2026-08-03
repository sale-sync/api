import { z } from 'zod';

export const CreatePlanSchema = z.object({
    plan_id: z.string().min(1, 'plan_id is required'),
    name: z.string().min(1, 'name is required'),
    info: z.string().min(1, 'info is required'),
    included: z.array(z.string()).min(1, 'included must have at least one item'),
    price: z.number().positive('price is required'),
    currency: z.string().min(1, 'currency is required'),
    billing_interval: z.literal('yearly'),
});

export type CreatePlanInput = z.infer<typeof CreatePlanSchema>;

export const UpdatePlanSchema = z.object({
    uuid: z.string().uuid('uuid must be a valid UUID'),
    name: z.string().min(1).optional(),
    info: z.string().min(1).optional(),
    included: z.array(z.string()).min(1).optional(),
    price: z.number().positive().optional(),
    currency: z.string().min(1).optional(),
});

export type UpdatePlanInput = z.infer<typeof UpdatePlanSchema>;
