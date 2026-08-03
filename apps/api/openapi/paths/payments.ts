import { z } from 'zod';

const security: Array<Record<string, string[]>> = [{ authenticationCookie: [], identifierCookie: [] }];

const PlanSchema = z.object({
    uuid: z.string().uuid(),
    plan_id: z.string(),
    name: z.string(),
    info: z.string(),
    included: z.array(z.string()),
    price: z.number().meta({ description: 'Annual amount charged (e.g. 240 for Basic, 600 for Pro) — billing is yearly-only, this is not a monthly rate' }),
    currency: z.string(),
    billing_interval: z.literal('yearly'),
});

const SubscriptionSchema = z.object({
    uuid: z.string().uuid(),
    organisation_id: z.string(),
    plan_id: z.string(),
    trial_start: z.string(),
    trial_end: z.string(),
    status: z.enum(['trialing', 'active', 'past_due', 'canceled']),
    payment_method: z.enum(['bank_transfer', 'stripe']).nullable(),
    activated_by: z.string().nullable(),
    activated_at: z.string().nullable(),
    promo_code: z.string().nullable().meta({ description: 'Code redeemed at signup, if any' }),
    discount_type: z.enum(['percentage', 'flat_amount']).nullable().meta({ description: 'Null if no code redeemed, or the redeemed code was a trial extension' }),
    discount_value: z.number().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
});

export const paymentsPaths = {
    '/payments': {
        get: {
            tags: ['Payments'],
            summary: 'List all subscription plans',
            description: 'Returns the plan catalogue (Basic/Pro tiers), each with its annual list price. Discounts, if any, only apply via a redeemed promo code — not reflected in this catalogue.',
            security,
            responses: {
                '200': {
                    description: 'List of plans',
                    content: {
                        'application/json': { schema: z.array(PlanSchema) },
                    },
                },
                '401': { description: 'Unauthorized' },
            },
        },
    },

    '/payments/by-id': {
        get: {
            tags: ['Payments'],
            summary: 'Lookup plan by plan_id slug',
            description: 'Resolves a plan slug (e.g. `basic`, `pro`) to its full metadata via the `PLAN#ID#` DynamoDB lookup item.',
            security,
            requestParams: {
                query: z.object({
                    id: z.string().meta({ description: 'Human-readable plan id slug (e.g. "basic", "pro")' }),
                }),
            },
            responses: {
                '200': {
                    description: 'Plan metadata',
                    content: {
                        'application/json': { schema: PlanSchema },
                    },
                },
                '400': {
                    description: 'Missing id query parameter',
                    content: {
                        'application/json': { schema: z.object({ message: z.string() }) },
                    },
                },
                '401': { description: 'Unauthorized' },
                '404': {
                    description: 'Plan not found',
                    content: {
                        'application/json': { schema: z.object({ message: z.string() }) },
                    },
                },
            },
        },
    },

    '/payments/subscription': {
        get: {
            tags: ['Payments'],
            summary: "Get an organisation's subscription/trial state",
            description: 'Returns the trial window, current plan, and payment status for a given organisation. One singleton record per organisation.',
            security,
            requestParams: {
                query: z.object({
                    organisation_id: z.string().meta({ description: "The organisation's uuid" }),
                }),
            },
            responses: {
                '200': {
                    description: 'Subscription record',
                    content: {
                        'application/json': { schema: SubscriptionSchema },
                    },
                },
                '400': {
                    description: 'Missing organisation_id query parameter',
                    content: {
                        'application/json': { schema: z.object({ message: z.string() }) },
                    },
                },
                '401': { description: 'Unauthorized' },
                '404': {
                    description: 'Subscription not found for this organisation',
                    content: {
                        'application/json': { schema: z.object({ message: z.string() }) },
                    },
                },
            },
        },
    },
};
