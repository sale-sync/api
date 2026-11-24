import { z } from 'zod';
import { DTO } from '@devyethiha/samjs';

/** The same address rule as making a link (links/dtos.ts); `count: false` resolves without counting (a repeat or a bot). */
export const ClickSchema = z.object({
    slug: z
        .string()
        .trim()
        .toLowerCase()
        .min(3)
        .max(60)
        .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    count: z.boolean().optional().default(true),
});
export type ClickInput = z.infer<typeof ClickSchema>;

export class ClickDTO extends DTO<typeof ClickSchema> {
    constructor() {
        super(ClickSchema);
    }
}
