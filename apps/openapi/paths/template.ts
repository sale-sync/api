import { z } from 'zod';
import { CreateTemplateSchema, AddTemplateSchema, RemoveTemplateSchema, SetActiveTemplateSchema } from '@sale-sync/shared';

const security: Array<Record<string, string[]>> = [{ authenticationCookie: [], identifierCookie: [] }];
const orgSecurity: Array<Record<string, string[]>> = [{ authenticationCookie: [], identifierCookie: [], organisationAuth: [] }];

const BusinessCategorySchema = z.enum(['fitness', 'real-estate', 'service-business', 'restaurant', 'haircut-and-salon']);
const ThemeFontSchema = z.enum(['sans', 'mono']);

const TemplateSchema = z.object({
    uuid: z.string().uuid(),
    name: z.string(),
    business_category: BusinessCategorySchema,
    preview_image: z.string(),
    created_at: z.string().datetime(),
});

const OrganisationTemplateSchema = z.object({
    template_uuid: z.string().uuid(),
    membership: z.object({
        template_uuid: z.string().uuid(),
        added_at: z.string().datetime(),
    }),
});

const BrandingColorScaleSchema = z.object({
    '50': z.string(),
    '100': z.string(),
    '200': z.string(),
    '300': z.string(),
    '400': z.string(),
    '500': z.string(),
    '600': z.string(),
    '700': z.string(),
    '800': z.string(),
    '900': z.string(),
    '950': z.string(),
});

const BrandingColorSchema = z.object({
    hex: z.string(),
    scale: BrandingColorScaleSchema,
});

// A staff-curated color-palette + font preset scoped to one template. Distinct from an
// organisation's own theme, which lives on its BrandingRecord (see /organisations/branding).
const PredefinedThemeSchema = z.object({
    uuid: z.string().uuid(),
    template_uuid: z.string().uuid(),
    name: z.string(),
    primaryColor: BrandingColorSchema,
    secondaryColor: BrandingColorSchema,
    font: ThemeFontSchema,
    created_at: z.string().datetime(),
});

export const templatePaths = {
    '/templates': {
        get: {
            tags: ['Template'],
            summary: 'List global template catalogue by business category',
            description: 'Returns all templates available for a given business category. Used during onboarding to let the user pick a template for their new organisation.',
            security,
            requestParams: {
                query: z.object({
                    category: BusinessCategorySchema.meta({ description: 'Business category to filter templates by' }),
                }),
            },
            responses: {
                '200': {
                    description: 'List of templates for the given category',
                    content: {
                        'application/json': { schema: z.array(TemplateSchema) },
                    },
                },
                '400': {
                    description: 'Missing or invalid category',
                    content: { 'application/json': { schema: z.object({ message: z.string() }) } },
                },
                '401': { description: 'Unauthorized' },
            },
        },
        post: {
            tags: ['Template'],
            summary: 'Create a template in the global catalogue',
            description: 'Adds a new template to the global catalogue for a business category. Intended for admin use — currently reachable by any authenticated user until admin tooling exists.',
            security,
            requestBody: {
                required: true,
                content: { 'application/json': { schema: CreateTemplateSchema } },
            },
            responses: {
                '201': {
                    description: 'Template created',
                    content: { 'application/json': { schema: TemplateSchema } },
                },
                '400': {
                    description: 'Validation error',
                    content: { 'application/json': { schema: z.object({ message: z.string(), issues: z.array(z.unknown()) }) } },
                },
                '401': { description: 'Unauthorized' },
            },
        },
    },

    '/organisations/templates': {
        get: {
            tags: ['Template'],
            summary: 'List templates — by business category, or the organisation\'s added templates',
            description: [
                'Accepts an optional `category` query parameter:',
                '',
                '- `category` — list the global template catalogue for a business category (used during onboarding)',
                '- (none) — list all templates the organisation (from the `Organisation` cookie) has added (used in settings)',
            ].join('\n'),
            security: orgSecurity,
            requestParams: {
                query: z.object({
                    category: BusinessCategorySchema.optional().meta({ description: 'Business category — returns global catalogue for that category' }),
                }),
            },
            responses: {
                '200': {
                    description: 'Response shape depends on whether `category` was provided',
                    content: {
                        'application/json': {
                            schema: z.union([
                                z.array(TemplateSchema).meta({ description: 'category → global catalogue' }),
                                z.array(OrganisationTemplateSchema).meta({ description: 'default → org template memberships' }),
                            ]),
                        },
                    },
                },
                '401': { description: 'Unauthorized' },
                '403': { description: 'No organisation context (only when category is not given)' },
            },
        },
        post: {
            tags: ['Template'],
            summary: 'Add a template to an organisation',
            description: 'Adds a template from the global catalogue to the organisation (from the `Organisation` cookie). Creates a `TEMPLATE#` membership item. Pass `set_active: true` to also update the organisation\'s active template in the same transaction (used during onboarding).',
            security: orgSecurity,
            requestBody: {
                required: true,
                content: { 'application/json': { schema: AddTemplateSchema } },
            },
            responses: {
                '201': {
                    description: 'Template added successfully',
                    content: { 'application/json': { schema: z.object({ message: z.string() }) } },
                },
                '400': {
                    description: 'Validation error',
                    content: { 'application/json': { schema: z.object({ message: z.string(), issues: z.array(z.unknown()) }) } },
                },
                '401': { description: 'Unauthorized' },
                '403': { description: 'No organisation context' },
                '404': {
                    description: 'Organisation or template not found',
                    content: { 'application/json': { schema: z.object({ message: z.string() }) } },
                },
            },
        },
        patch: {
            tags: ['Template'],
            summary: 'Set the active template for an organisation',
            description: 'Updates `template_id` on the organisation (from the `Organisation` cookie) metadata. The template must already be in the org\'s collection.',
            security: orgSecurity,
            requestBody: {
                required: true,
                content: { 'application/json': { schema: SetActiveTemplateSchema } },
            },
            responses: {
                '200': {
                    description: 'Active template updated',
                    content: { 'application/json': { schema: z.object({ message: z.string() }) } },
                },
                '400': {
                    description: 'Validation error',
                    content: { 'application/json': { schema: z.object({ message: z.string(), issues: z.array(z.unknown()) }) } },
                },
                '401': { description: 'Unauthorized' },
                '403': { description: 'No organisation context' },
                '404': {
                    description: 'Organisation not found or template not in org collection',
                    content: { 'application/json': { schema: z.object({ message: z.string() }) } },
                },
            },
        },
        delete: {
            tags: ['Template'],
            summary: 'Remove a template from an organisation',
            description: 'Removes a template from the organisation (from the `Organisation` cookie). Returns 409 if the template is currently active.',
            security: orgSecurity,
            requestBody: {
                required: true,
                content: { 'application/json': { schema: RemoveTemplateSchema } },
            },
            responses: {
                '200': {
                    description: 'Template removed successfully',
                    content: { 'application/json': { schema: z.object({ message: z.string() }) } },
                },
                '400': {
                    description: 'Validation error',
                    content: { 'application/json': { schema: z.object({ message: z.string(), issues: z.array(z.unknown()) }) } },
                },
                '401': { description: 'Unauthorized' },
                '403': { description: 'No organisation context' },
                '404': {
                    description: 'Organisation not found',
                    content: { 'application/json': { schema: z.object({ message: z.string() }) } },
                },
                '409': {
                    description: 'Cannot remove the currently active template',
                    content: { 'application/json': { schema: z.object({ message: z.string() }) } },
                },
            },
        },
    },

    '/organisations/templates/theme': {
        get: {
            tags: ['Template'],
            summary: 'List or get predefined theme(s) for a template',
            description: [
                'Staff-curated color-palette + font presets scoped to a template — the catalog an organisation',
                'picks from (e.g. during onboarding), not the organisation\'s own theme (see `/organisations/branding`',
                'for that). Accepts an optional `themeUuid` query parameter:',
                '',
                '- `themeUuid` provided — get a single predefined theme',
                '- (none) — list every predefined theme for the template',
            ].join('\n'),
            security: orgSecurity,
            requestParams: {
                query: z.object({
                    templateUuid: z.string().uuid().meta({ description: 'Template UUID' }),
                    themeUuid: z.string().uuid().optional().meta({ description: 'Predefined theme UUID — omit to list all themes for the template' }),
                }),
            },
            responses: {
                '200': {
                    description: 'Response shape depends on whether `themeUuid` was provided',
                    content: {
                        'application/json': {
                            schema: z.union([
                                PredefinedThemeSchema.meta({ description: 'themeUuid → single predefined theme' }),
                                z.array(PredefinedThemeSchema).meta({ description: 'default → every predefined theme for the template' }),
                            ]),
                        },
                    },
                },
                '400': {
                    description: 'Missing templateUuid query parameter',
                    content: { 'application/json': { schema: z.object({ message: z.string() }) } },
                },
                '401': { description: 'Unauthorized' },
                '404': {
                    description: 'Theme not found (only when themeUuid is given)',
                    content: { 'application/json': { schema: z.object({ message: z.string() }) } },
                },
            },
        },
    },
};
