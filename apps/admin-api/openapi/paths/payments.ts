import { z } from 'zod';
import { CreatePlanSchema, UpdatePlanSchema, CreateSubscriptionSchema, UpdateSubscriptionSchema } from '@sale-sync/shared';

const security: Array<Record<string, string[]>> = [{ authenticationCookie: [], identifierCookie: [] }];

const PlanSchema = z.object({
    uuid: z.string().uuid(),
    plan_id: z.string(),
    name: z.string(),
    info: z.string(),
    included: z.array(z.string()),
    price: z.number().meta({ description: 'Annual amount charged (e.g. 240 for Basic, 600 for Pro) — billing is yearly-only' }),
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
            description: 'Returns all available subscription plans.',
            security,
            responses: {
                '200': {
                    description: 'List of plans',
                    content: { 'application/json': { schema: z.array(PlanSchema) } },
                },
                '401': { description: 'Unauthorized' },
            },
        },
        post: {
            tags: ['Payments'],
            summary: 'Create a new subscription plan',
            description: 'Creates a new plan (e.g. basic, pro) that clients can subscribe to. Exactly two tiers are expected to exist (Basic, Pro) — this endpoint is for staff catalogue management, not open-ended tier creation.',
            security,
            requestBody: {
                required: true,
                content: { 'application/json': { schema: CreatePlanSchema } },
            },
            responses: {
                '201': {
                    description: 'Plan created',
                    content: { 'application/json': { schema: z.object({ message: z.string(), uuid: z.string().uuid() }) } },
                },
                '400': {
                    description: 'Validation error',
                    content: { 'application/json': { schema: z.object({ message: z.string(), issues: z.array(z.unknown()) }) } },
                },
                '401': { description: 'Unauthorized' },
                '409': {
                    description: 'Plan with that plan_id already exists',
                    content: { 'application/json': { schema: z.object({ message: z.string() }) } },
                },
            },
        },
        patch: {
            tags: ['Payments'],
            summary: 'Update an existing plan',
            description: 'Updates name, info, price, currency, or included features of a plan. Identified by UUID.',
            security,
            requestBody: {
                required: true,
                content: { 'application/json': { schema: UpdatePlanSchema } },
            },
            responses: {
                '200': {
                    description: 'Plan updated',
                    content: { 'application/json': { schema: z.object({ message: z.string() }) } },
                },
                '400': {
                    description: 'Validation error',
                    content: { 'application/json': { schema: z.object({ message: z.string(), issues: z.array(z.unknown()) }) } },
                },
                '401': { description: 'Unauthorized' },
                '404': {
                    description: 'Plan not found',
                    content: { 'application/json': { schema: z.object({ message: z.string() }) } },
                },
            },
        },
    },

    '/payments/by-id': {
        get: {
            tags: ['Payments'],
            summary: 'Get plan by plan_id slug',
            security,
            requestParams: {
                query: z.object({
                    id: z.string().meta({ description: 'Plan slug (e.g. "basic", "pro")' }),
                }),
            },
            responses: {
                '200': {
                    description: 'Plan metadata',
                    content: { 'application/json': { schema: PlanSchema } },
                },
                '400': { description: 'Missing id query parameter', content: { 'application/json': { schema: z.object({ message: z.string() }) } } },
                '401': { description: 'Unauthorized' },
                '404': { description: 'Plan not found', content: { 'application/json': { schema: z.object({ message: z.string() }) } } },
            },
        },
        delete: {
            tags: ['Payments'],
            summary: 'Delete a plan by plan_id slug',
            description: 'Removes the plan metadata and slug lookup item in one transaction.',
            security,
            requestParams: {
                query: z.object({
                    id: z.string().meta({ description: 'Plan slug to delete' }),
                }),
            },
            responses: {
                '200': {
                    description: 'Plan deleted',
                    content: { 'application/json': { schema: z.object({ message: z.string() }) } },
                },
                '400': { description: 'Missing id query parameter', content: { 'application/json': { schema: z.object({ message: z.string() }) } } },
                '401': { description: 'Unauthorized' },
                '404': { description: 'Plan not found', content: { 'application/json': { schema: z.object({ message: z.string() }) } } },
            },
        },
    },

    '/payments/subscription': {
        get: {
            tags: ['Payments'],
            summary: "Get an organisation's subscription/trial state",
            security,
            requestParams: {
                query: z.object({
                    organisation_id: z.string().meta({ description: "The organisation's uuid" }),
                }),
            },
            responses: {
                '200': {
                    description: 'Subscription record',
                    content: { 'application/json': { schema: SubscriptionSchema } },
                },
                '400': { description: 'Missing organisation_id query parameter', content: { 'application/json': { schema: z.object({ message: z.string() }) } } },
                '401': { description: 'Unauthorized' },
                '404': { description: 'Subscription not found for this organisation', content: { 'application/json': { schema: z.object({ message: z.string() }) } } },
            },
        },
        post: {
            tags: ['Payments'],
            summary: "Create an organisation's subscription/trial record",
            description: 'Creates the singleton subscription record for an organisation (trial window + plan). One per organisation.',
            security,
            requestBody: {
                required: true,
                content: { 'application/json': { schema: CreateSubscriptionSchema } },
            },
            responses: {
                '201': {
                    description: 'Subscription created',
                    content: { 'application/json': { schema: SubscriptionSchema } },
                },
                '400': {
                    description: 'Validation error',
                    content: { 'application/json': { schema: z.object({ message: z.string(), issues: z.array(z.unknown()) }) } },
                },
                '401': { description: 'Unauthorized' },
                '409': {
                    description: 'Subscription for this organisation already exists',
                    content: { 'application/json': { schema: z.object({ message: z.string() }) } },
                },
            },
        },
        patch: {
            tags: ['Payments'],
            summary: "Update an organisation's subscription/trial record",
            description: 'Status transitions (e.g. past_due -> active on a manually-recorded payment), plan changes, trial extension.',
            security,
            requestBody: {
                required: true,
                content: { 'application/json': { schema: UpdateSubscriptionSchema } },
            },
            responses: {
                '200': {
                    description: 'Subscription updated',
                    content: { 'application/json': { schema: SubscriptionSchema } },
                },
                '400': {
                    description: 'Validation error',
                    content: { 'application/json': { schema: z.object({ message: z.string(), issues: z.array(z.unknown()) }) } },
                },
                '401': { description: 'Unauthorized' },
                '404': {
                    description: 'Subscription not found for this organisation',
                    content: { 'application/json': { schema: z.object({ message: z.string() }) } },
                },
            },
        },
    },
};
