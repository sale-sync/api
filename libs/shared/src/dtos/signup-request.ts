import { z } from 'zod';

// Admin action on a pending signup request — PATCH /signup-requests/by-id.
// rejection_reason is required when action is 'reject', optional (ignored) on 'approve'.
export const SignupRequestActionSchema = z
    .object({
        uuid: z.string().uuid('uuid must be a valid UUID'),
        action: z.enum(['approve', 'reject']),
        rejection_reason: z.string().min(1).optional(),
    })
    .refine((data) => data.action !== 'reject' || !!data.rejection_reason, {
        message: 'rejection_reason is required when action is reject',
        path: ['rejection_reason'],
    });

export type SignupRequestActionInput = z.infer<typeof SignupRequestActionSchema>;
