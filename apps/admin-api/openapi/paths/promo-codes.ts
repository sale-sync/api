import { z } from 'zod';
import { CreatePromoCodeSchema, UpdatePromoCodeSchema } from '@sale-sync/shared';

const security: Array<Record<string, string[]>> = [{ authenticationCookie: [], identifierCookie: [] }];

const PromoCodeSchema = z.object({
    uuid: z.string().uuid(),
    code: z.string().meta({ description: 'Stored uppercased — redemption lookups are case-insensitive' }),
    type: z.enum(['percentage', 'flat_amount', 'trial_extension_days']),
    value: z.number().meta({ description: 'Percentage (0-100], currency amount, or whole days, depending on type' }),
    max_redemptions: z.number().nullable().meta({ description: 'Null = unlimited distinct orgs may redeem this code' }),
    redemption_count: z.number(),
    expires_at: z.string().nullable(),
    status: z.enum(['active', 'disabled']),
    created_by: z.string().meta({ description: 'Staff user id who created the code' }),
    created_at: z.string(),
    updated_at: z.string(),
});

export const promoCodesPaths = {
    '/promo-codes': {
        get: {
            tags: ['Promo Codes'],
            summary: 'List all promo codes',
            description: 'Returns every staff-created discount/trial-extension code, including its redemption count.',
            security,
            responses: {
                '200': {
                    description: 'List of promo codes',
                    content: { 'application/json': { schema: z.array(PromoCodeSchema) } },
                },
                '401': { description: 'Unauthorized' },
            },
        },
        post: {
            tags: ['Promo Codes'],
            summary: 'Create a new promo code',
            description: 'Creates a discount (percentage/flat_amount) or trial-extension (trial_extension_days) code. This is the only discounting mechanism in the system — redeemed self-serve at organisation signup.',
            security,
            requestBody: {
                required: true,
                content: { 'application/json': { schema: CreatePromoCodeSchema } },
            },
            responses: {
                '201': {
                    description: 'Promo code created',
                    content: { 'application/json': { schema: PromoCodeSchema } },
                },
                '400': {
                    description: 'Validation error',
                    content: { 'application/json': { schema: z.object({ message: z.string(), issues: z.array(z.unknown()) }) } },
                },
                '401': { description: 'Unauthorized' },
                '409': {
                    description: 'A promo code with that code string already exists',
                    content: { 'application/json': { schema: z.object({ message: z.string() }) } },
                },
            },
        },
        patch: {
            tags: ['Promo Codes'],
            summary: 'Update an existing promo code',
            description: 'Only status, max_redemptions, and expires_at are patchable — code/type/value cannot change after creation. Identified by UUID.',
            security,
            requestBody: {
                required: true,
                content: { 'application/json': { schema: UpdatePromoCodeSchema } },
            },
            responses: {
                '200': {
                    description: 'Promo code updated',
                    content: { 'application/json': { schema: PromoCodeSchema } },
                },
                '400': {
                    description: 'Validation error',
                    content: { 'application/json': { schema: z.object({ message: z.string(), issues: z.array(z.unknown()) }) } },
                },
                '401': { description: 'Unauthorized' },
                '404': {
                    description: 'Promo code not found',
                    content: { 'application/json': { schema: z.object({ message: z.string() }) } },
                },
            },
        },
    },

    '/promo-codes/by-id': {
        get: {
            tags: ['Promo Codes'],
            summary: 'Get a promo code by UUID',
            security,
            requestParams: {
                query: z.object({
                    id: z.string().uuid().meta({ description: 'Promo code uuid' }),
                }),
            },
            responses: {
                '200': {
                    description: 'Promo code',
                    content: { 'application/json': { schema: PromoCodeSchema } },
                },
                '400': { description: 'Missing id query parameter', content: { 'application/json': { schema: z.object({ message: z.string() }) } } },
                '401': { description: 'Unauthorized' },
                '404': { description: 'Promo code not found', content: { 'application/json': { schema: z.object({ message: z.string() }) } } },
            },
        },
        delete: {
            tags: ['Promo Codes'],
            summary: 'Delete a promo code by UUID',
            description: 'Only allowed if the code has never been redeemed (redemption_count === 0) — otherwise 409, disable it instead to preserve the audit trail.',
            security,
            requestParams: {
                query: z.object({
                    id: z.string().uuid().meta({ description: 'Promo code uuid to delete' }),
                }),
            },
            responses: {
                '200': {
                    description: 'Promo code deleted',
                    content: { 'application/json': { schema: z.object({ message: z.string() }) } },
                },
                '400': { description: 'Missing id query parameter', content: { 'application/json': { schema: z.object({ message: z.string() }) } } },
                '401': { description: 'Unauthorized' },
                '404': { description: 'Promo code not found', content: { 'application/json': { schema: z.object({ message: z.string() }) } } },
                '409': {
                    description: 'Promo code has already been redeemed — disable it instead of deleting',
                    content: { 'application/json': { schema: z.object({ message: z.string() }) } },
                },
            },
        },
    },
};
