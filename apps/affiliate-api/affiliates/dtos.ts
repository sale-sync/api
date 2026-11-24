import { z } from 'zod';
import { DTO } from '@devyethiha/samjs';
import { MARKETS } from '../shared/rules';

const name = z.string().trim().min(1, 'Required').max(80);
export const ApplicationSchema = z.object({
    market: z.enum(MARKETS as [string, ...string[]]),
    first: name,
    last: name,
    phone: z.string().trim().max(30).optional().default(''),
    reach: z.enum(['creator', 'sales', 'network', 'other']),
    channelUrl: z.string().trim().max(300).optional().default(''),
    plan: z.string().trim().max(2000).optional().default(''),
});
export const ProfileSchema = z.object({ first: name, last: name, phone: z.string().trim().max(30).optional().default('') });
export type ApplicationInput = z.infer<typeof ApplicationSchema>;
export type ProfileInput = z.infer<typeof ProfileSchema>;

export class ApplicationDTO extends DTO<typeof ApplicationSchema> {
    constructor() {
        super(ApplicationSchema);
    }
}
export class ProfileDTO extends DTO<typeof ProfileSchema> {
    constructor() {
        super(ProfileSchema);
    }
}
