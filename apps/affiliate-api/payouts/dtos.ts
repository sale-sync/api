import { z } from 'zod';
import { DTO } from '@devyethiha/samjs';

const name = z.string().trim().min(1, 'Required').max(80);
export const PayoutMethodSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('stripe') }),
    z.object({
        kind: z.literal('bank'),
        accountName: name,
        bank: z.string().trim().min(1, 'Required').max(80),
        branch: z.string().trim().max(10).optional().default(''), // BSB in Australia, empty in Thailand
        accountNumber: z.string().trim().regex(/^[0-9 -]{6,30}$/, 'Enter your account number'),
    }),
]);
export type PayoutMethodInput = z.infer<typeof PayoutMethodSchema>;

export class PayoutMethodDTO extends DTO<typeof PayoutMethodSchema> {
    constructor() {
        super(PayoutMethodSchema);
    }
}
