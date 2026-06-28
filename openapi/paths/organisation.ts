import { z } from 'zod';
import { CreateOrganisationSchema } from '@sales-sync/shared';

const security: Array<Record<string, string[]>> = [{ bearerAuth: [] }];

const OrganisationSchema = z.object({
    organisation_id: z.string(),
    organisation_name: z.string(),
    user_id: z.string(),
    created_at: z.string(),
});

export const organisationPaths = {
    '/organisations': {
        get: {
            tags: ['Organisation'],
            summary: 'List organisations for the authenticated user',
            security,
            responses: {
                '200': {
                    description: 'List of organisations',
                    content: {
                        'application/json': { schema: z.array(OrganisationSchema) },
                    },
                },
                '401': { description: 'Unauthorized' },
            },
        },
        post: {
            tags: ['Organisation'],
            summary: 'Create a new organisation',
            security,
            requestBody: {
                content: {
                    'application/json': { schema: CreateOrganisationSchema },
                },
            },
            responses: {
                '201': {
                    description: 'Organisation created',
                    content: {
                        'application/json': {
                            schema: z.object({
                                message: z.string(),
                                organisation_id: z.string(),
                                organisation_name: z.string(),
                            }),
                        },
                    },
                },
                '400': { description: 'Validation error' },
                '401': { description: 'Unauthorized' },
                '409': { description: 'Organisation already exists' },
            },
        },
    },
};
