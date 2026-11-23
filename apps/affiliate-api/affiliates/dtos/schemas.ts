import { z } from 'zod';
import { CHANNELS, MARKETS } from '../domain/rules';

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
export type ApplicationInput = z.infer<typeof ApplicationSchema>;
export type ProfileInput = z.infer<typeof ProfileSchema>;
export type LinkInput = z.infer<typeof LinkSchema>;
export type PayoutMethodInput = z.infer<typeof PayoutMethodSchema>;
