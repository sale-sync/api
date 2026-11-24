import { z } from 'zod';
import { DTO } from '@devyethiha/samjs';
import { CHANNELS } from '../shared/rules';

export const LinkSchema = z.object({
    channel: z.enum(CHANNELS as [string, ...string[]]),
    name: z.string().trim().max(60).optional().default(''),
    slug: z
        .string()
        .trim()
        .min(3)
        .max(60)
        .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Lowercase letters, numbers and single dashes only'),
});
export type LinkInput = z.infer<typeof LinkSchema>;

export class LinkDTO extends DTO<typeof LinkSchema> {
    constructor() {
        super(LinkSchema);
    }
}
