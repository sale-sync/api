import { z } from 'zod';
import { CreateOrganisationSchema } from '@sales-sync/shared';

const security: Array<Record<string, string[]>> = [{ authenticationCookie: [], identifierCookie: [] }];

const ImageSchema = z.object({
    name: z.string(),
    url: z.string(),
    size: z.string(),
    mime_type: z.string(),
});

const OrganisationSchema = z.object({
    uuid: z.string().uuid(),
    id: z.string(),
    name: z.string(),
    status: z.enum(['pending', 'active']),
    image: ImageSchema.nullable(),
    business_category: z.enum(['fitness', 'real-estate', 'service-business', 'restaurant', 'barber']),
    template_id: z.string().uuid(),
    plan_id: z.string().uuid(),
    created_at: z.string().datetime(),
    description: z.string().optional(),
});

const OrganisationUserSchema = z.object({
    user_id: z.string(),
    membership: z.object({
        role: z.enum(['owner', 'admin', 'manager', 'editor', 'staff']),
        position: z.string().optional(),
        joined_date: z.string().datetime(),
    }),
});

export const organisationPaths = {
    '/organisations': {
        get: {
            tags: ['Organisation'],
            summary: 'List organisations for the authenticated user',
            description: 'Returns all organisations the authenticated user belongs to, with full metadata hydrated.',
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
            description: 'Creates an organisation and sets the caller as owner. Organisation starts in `pending` status.',
            security,
            requestBody: {
                required: true,
                content: {
                    'application/json': { schema: CreateOrganisationSchema },
                },
            },
            responses: {
                '201': {
                    description: 'Organisation created successfully',
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
                '400': {
                    description: 'Validation error',
                    content: {
                        'application/json': {
                            schema: z.object({
                                message: z.string(),
                                issues: z.array(z.unknown()),
                            }),
                        },
                    },
                },
                '401': { description: 'Unauthorized' },
                '409': {
                    description: 'Organisation with that id already exists',
                    content: {
                        'application/json': {
                            schema: z.object({ message: z.string() }),
                        },
                    },
                },
            },
        },
    },

    '/organisations/by-id': {
        get: {
            tags: ['Organisation'],
            summary: 'Lookup organisation by id (slug)',
            description: 'Resolves a human-readable organisation id (e.g. `potato-rocket`) to its full metadata via the `ORG#ID#` DynamoDB lookup item.',
            security,
            requestParams: {
                query: z.object({
                    id: z.string().meta({ description: 'Human-readable organisation id (slug)' }),
                }),
            },
            responses: {
                '200': {
                    description: 'Organisation metadata',
                    content: {
                        'application/json': { schema: OrganisationSchema },
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
                    description: 'Organisation not found',
                    content: {
                        'application/json': { schema: z.object({ message: z.string() }) },
                    },
                },
            },
        },
    },

    '/organisations/users': {
        get: {
            tags: ['Organisation'],
            summary: 'User lookups — list members or find a user',
            description: [
                'Accepts one of three mutually exclusive query parameters:',
                '',
                '- `orgUuid` — list all users in an organisation (`PK=ORG#{uuid}` main table query)',
                '- `email` — lookup a user by email address (`PK=USER#{email}` GetItem)',
                '- `userId` — lookup a user by user id (inverted-index query on `SK=USER#{userId}`)',
            ].join('\n'),
            security,
            requestParams: {
                query: z.object({
                    orgUuid: z.string().uuid().optional().meta({ description: 'Organisation UUID — returns all member records' }),
                    email: z.string().email().optional().meta({ description: 'User email address — returns matching user_id' }),
                    userId: z.string().optional().meta({ description: 'User id — returns matching email address' }),
                }),
            },
            responses: {
                '200': {
                    description: 'Response shape depends on the query parameter used',
                    content: {
                        'application/json': {
                            schema: z.union([
                                z.array(OrganisationUserSchema).meta({ description: 'orgUuid → array of members' }),
                                z.object({ user_id: z.string() }).meta({ description: 'email → user_id' }),
                                z.object({ email: z.string() }).meta({ description: 'userId → email' }),
                            ]),
                        },
                    },
                },
                '400': {
                    description: 'No recognised query parameter provided',
                    content: {
                        'application/json': { schema: z.object({ message: z.string() }) },
                    },
                },
                '401': { description: 'Unauthorized' },
                '404': {
                    description: 'User or organisation not found',
                    content: {
                        'application/json': { schema: z.object({ message: z.string() }) },
                    },
                },
            },
        },
    },
};
