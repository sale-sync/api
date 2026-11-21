import { z } from 'zod';
import { AdminUpdateOrganisationSchema } from '@sale-sync/shared';

const security: Array<Record<string, string[]>> = [{ authenticationCookie: [], identifierCookie: [] }];

const OrganisationSchema = z.object({
    uuid: z.string().uuid(),
    id: z.string(),
    name: z.string(),
    status: z.enum(['pending', 'active', 'suspended']),
    image: z.object({ name: z.string(), url: z.string(), size: z.string(), mime_type: z.string() }).nullable(),
    business_category: z.enum(['fitness', 'real-estate', 'service-business', 'restaurant', 'haircut-and-salon']),
    template_id: z.string().uuid(),
    plan_id: z.string().uuid(),
    created_at: z.string().datetime(),
    description: z.string().optional(),
});

export const organisationPaths = {
    '/organisations': {
        get: {
            tags: ['Organisation'],
            summary: 'List all client organisations',
            description: 'Returns all organisations across all clients, paginated via `lastKey`.',
            security,
            requestParams: {
                query: z.object({
                    lastKey: z.string().optional().meta({ description: 'Pagination cursor — value of SK from the last item of the previous page' }),
                    limit: z.string().optional().meta({ description: 'Max items per page (default 50)' }),
                }),
            },
            responses: {
                '200': {
                    description: 'Paginated list of organisations',
                    content: {
                        'application/json': {
                            schema: z.object({
                                items: z.array(OrganisationSchema),
                                lastKey: z.string().optional().meta({ description: 'Pass as lastKey to fetch the next page; absent when no more pages' }),
                            }),
                        },
                    },
                },
                '401': { description: 'Unauthorized' },
            },
        },
    },

    '/organisations/by-id': {
        get: {
            tags: ['Organisation'],
            summary: 'Get client organisation by id slug',
            security,
            requestParams: {
                query: z.object({
                    id: z.string().meta({ description: 'Organisation id slug (e.g. "potato-rocket")' }),
                }),
            },
            responses: {
                '200': { description: 'Organisation metadata', content: { 'application/json': { schema: OrganisationSchema } } },
                '400': { description: 'Missing id', content: { 'application/json': { schema: z.object({ message: z.string() }) } } },
                '401': { description: 'Unauthorized' },
                '404': { description: 'Organisation not found', content: { 'application/json': { schema: z.object({ message: z.string() }) } } },
            },
        },
        patch: {
            tags: ['Organisation'],
            summary: 'Update a client organisation',
            description: 'Allows SaleSync admins to change an organisation\'s status (e.g. activate, suspend) or reassign its plan.',
            security,
            requestBody: {
                required: true,
                content: { 'application/json': { schema: AdminUpdateOrganisationSchema } },
            },
            responses: {
                '200': { description: 'Organisation updated', content: { 'application/json': { schema: z.object({ message: z.string() }) } } },
                '400': { description: 'Validation error', content: { 'application/json': { schema: z.object({ message: z.string(), issues: z.array(z.unknown()) }) } } },
                '401': { description: 'Unauthorized' },
                '404': { description: 'Organisation not found', content: { 'application/json': { schema: z.object({ message: z.string() }) } } },
            },
        },
    },
};
