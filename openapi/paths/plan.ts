import { z } from 'zod';

const security: Array<Record<string, string[]>> = [{ authenticationCookie: [], identifierCookie: [] }];

const PlanSchema = z.object({
    uuid: z.string().uuid(),
    plan_id: z.string(),
    name: z.string(),
    info: z.string(),
    included: z.array(z.string()),
});

export const planPaths = {
    '/plans': {
        get: {
            tags: ['Plan'],
            summary: 'List all subscription plans',
            description: 'Returns all available subscription plans (e.g. basic, pro).',
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

    '/plans/by-id': {
        get: {
            tags: ['Plan'],
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
};
