import { z } from 'zod';
import { AddTeamMemberSchema, AddTeamMemberByUserIdSchema, CreateOrganisationSchema, RemoveTeamMemberSchema, UpdateTeamMemberRoleSchema } from '@sale-sync/shared';

const security: Array<Record<string, string[]>> = [{ authenticationCookie: [], identifierCookie: [] }];
const orgSecurity: Array<Record<string, string[]>> = [{ authenticationCookie: [], identifierCookie: [], organisationAuth: [] }];

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
    business_category: z.enum(['fitness', 'real-estate', 'service-business', 'restaurant', 'haircut-and-salon']),
    template_id: z.string().uuid(),
    plan_id: z.string().uuid(),
    created_at: z.string().datetime(),
    description: z.string().optional(),
});

const OrganisationUserSchema = z.object({
    user_id: z.string(),
    email: z.string().email(),
    membership: z.object({
        role: z.enum(['owner', 'admin', 'manager', 'editor', 'staff', 'guest']),
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

    '/organisations/team': {
        post: {
            tags: ['Organisation'],
            summary: 'Add team member(s) by email',
            description: [
                'Adds one or more users to the organisation (resolved from the `Organisation` cookie) by email address.',
                '',
                'The `user_id` is resolved from the Cognito account via the `USER#{email}` lookup item (`PK=USER#{email}, SK=META`).',
                '',
                '- **Registered user** — membership item is written as `PK=ORG#{uuid}, SK=USER#{user_id}` with role `staff`.',
                '- **Unregistered user** — nothing is written. No pending-invite state exists at this stage; the caller should ask them to register first, then retry.',
                '',
                'Returns two arrays: `added` (registered users that were added) and `not_found` (unregistered emails).',
            ].join('\n'),
            security: orgSecurity,
            requestBody: {
                required: true,
                content: { 'application/json': { schema: AddTeamMemberSchema } },
            },
            responses: {
                '201': {
                    description: 'Team member(s) added',
                    content: {
                        'application/json': {
                            schema: z.object({
                                message: z.string(),
                                added: z.array(z.string().email()).meta({ description: 'Registered users that were added as members' }),
                                not_found: z.array(z.string().email()).meta({ description: 'Unregistered emails — nothing was written for these' }),
                            }),
                        },
                    },
                },
                '400': {
                    description: 'Validation error',
                    content: { 'application/json': { schema: z.object({ message: z.string(), issues: z.array(z.unknown()) }) } },
                },
                '401': { description: 'Unauthorized' },
                '403': { description: 'No organisation context, or caller is not owner/admin (only owner/admin may manage the team)' },
            },
        },
        delete: {
            tags: ['Organisation'],
            summary: 'Remove a team member',
            description: [
                'Removes a member from the organisation (resolved from the `Organisation` cookie) by `user_id`.',
                '',
                'Deletes the membership item `PK=ORG#{uuid}, SK=USER#{user_id}`.',
                '',
                "An organisation must always have at least one `owner` — removing the sole remaining owner is rejected.",
            ].join('\n'),
            security: orgSecurity,
            requestBody: {
                required: true,
                content: { 'application/json': { schema: RemoveTeamMemberSchema } },
            },
            responses: {
                '200': {
                    description: 'Team member removed',
                    content: { 'application/json': { schema: z.object({ message: z.string() }) } },
                },
                '400': {
                    description: 'Validation error',
                    content: { 'application/json': { schema: z.object({ message: z.string(), issues: z.array(z.unknown()) }) } },
                },
                '401': { description: 'Unauthorized' },
                '403': {
                    description:
                        'No organisation context, or caller is not owner/admin (only owner/admin may manage the team), or caller is not an owner (only an owner may remove another owner)',
                },
                '409': {
                    description: 'Cannot remove the last remaining owner',
                    content: { 'application/json': { schema: z.object({ message: z.string() }) } },
                },
            },
        },
        patch: {
            tags: ['Organisation'],
            summary: "Update a team member's role",
            description: [
                'Updates the role of a member of the organisation (resolved from the `Organisation` cookie), identified by `user_id`.',
                '',
                'Overwrites the `role` field of the membership item `PK=ORG#{uuid}, SK=USER#{user_id}`.',
                '',
                "An organisation must always have at least one `owner` — demoting the sole remaining owner away from `owner` is rejected.",
            ].join('\n'),
            security: orgSecurity,
            requestBody: {
                required: true,
                content: { 'application/json': { schema: UpdateTeamMemberRoleSchema } },
            },
            responses: {
                '200': {
                    description: 'Team member role updated',
                    content: { 'application/json': { schema: z.object({ message: z.string() }) } },
                },
                '400': {
                    description: 'Validation error',
                    content: { 'application/json': { schema: z.object({ message: z.string(), issues: z.array(z.unknown()) }) } },
                },
                '401': { description: 'Unauthorized' },
                '403': {
                    description:
                        "No organisation context, or caller is not owner/admin (only owner/admin may manage the team), or caller is not an owner (only an owner may change another owner's role)",
                },
                '409': {
                    description: 'Cannot demote the last remaining owner',
                    content: { 'application/json': { schema: z.object({ message: z.string() }) } },
                },
            },
        },
    },

    '/organisations/team-member': {
        post: {
            tags: ['Organisation'],
            summary: 'Add team member(s) by user_id (uuid)',
            description: [
                'Adds one or more users to the organisation (resolved from the `Organisation` cookie) by `user_id`.',
                '',
                'Unlike `POST /organisations/team`, this does not resolve an email to a `user_id` — it expects the caller',
                'already knows the `user_id` (e.g. from a prior `GET /organisations/users?email=` lookup). This covers the',
                'case where a user already has a Cognito account but is not yet a member of this organisation.',
                '',
                'Each `user_id` is checked against the inverted index; unknown ids are reported back rather than written.',
                '',
                '- **Found** — membership item is written as `PK=ORG#{uuid}, SK=USER#{user_id}` with role `staff`.',
                '- **Not found** — no Cognito account exists for that `user_id`; nothing is written.',
                '',
                'Returns two arrays: `added` (membership written) and `not_found` (unknown user ids).',
            ].join('\n'),
            security: orgSecurity,
            requestBody: {
                required: true,
                content: { 'application/json': { schema: AddTeamMemberByUserIdSchema } },
            },
            responses: {
                '201': {
                    description: 'Team member(s) added',
                    content: {
                        'application/json': {
                            schema: z.object({
                                message: z.string(),
                                added: z.array(z.string()).meta({ description: 'user_ids that were added as members' }),
                                not_found: z.array(z.string()).meta({ description: 'user_ids with no matching Cognito account' }),
                            }),
                        },
                    },
                },
                '400': {
                    description: 'Validation error',
                    content: { 'application/json': { schema: z.object({ message: z.string(), issues: z.array(z.unknown()) }) } },
                },
                '401': { description: 'Unauthorized' },
                '403': { description: 'No organisation context, or caller is not owner/admin (only owner/admin may manage the team)' },
            },
        },
    },

    '/organisations/users': {
        get: {
            tags: ['Organisation'],
            summary: 'User lookups — list org members or find a user',
            description: [
                'Accepts one of two optional, mutually exclusive query parameters. Otherwise, lists all members of the organisation resolved from the `Organisation` cookie:',
                '',
                '- (none) — list all users in the organisation (`PK=ORG#{uuid}` main table query)',
                '- `email` — lookup a user by email address (`PK=USER#{email}` GetItem) — not scoped to an organisation',
                '- `userId` — lookup a user by user id (inverted-index query on `SK=USER#{userId}`) — not scoped to an organisation',
            ].join('\n'),
            security: orgSecurity,
            requestParams: {
                query: z.object({
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
                                z.array(OrganisationUserSchema).meta({ description: 'default → array of org members' }),
                                z.object({ user_id: z.string() }).meta({ description: 'email → user_id' }),
                                z.object({ email: z.string() }).meta({ description: 'userId → email' }),
                            ]),
                        },
                    },
                },
                '401': { description: 'Unauthorized' },
                '403': { description: 'No organisation context (only when neither email nor userId is given)' },
                '404': {
                    description: 'User not found',
                    content: {
                        'application/json': { schema: z.object({ message: z.string() }) },
                    },
                },
            },
        },
    },
};
