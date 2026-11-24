import { DTO } from '@devyethiha/samjs';
import { z } from 'zod';

// A decision on one application. Refusing needs a reason: the applicant sees it on their dashboard.
export const DecisionSchema = z
    .object({
        userId: z.string().trim().min(1).max(128),
        decision: z.enum(['approve', 'refuse']),
        reason: z.string().trim().max(1000).optional(),
    })
    .refine((d) => d.decision === 'approve' || (d.reason ?? '').length >= 10, { message: 'A refusal needs a reason of at least 10 characters', path: ['reason'] });
export type DecisionInput = z.infer<typeof DecisionSchema>;

export class DecisionDTO extends DTO<typeof DecisionSchema> {
    constructor() {
        super(DecisionSchema);
    }
}
