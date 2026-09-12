import { z } from 'zod';
import { AddTemplateSchema, RemoveTemplateSchema, SetActiveTemplateSchema } from '@sale-sync/shared';

const orgSecurity: Array<Record<string, string[]>> = [{ authenticationCookie: [], identifierCookie: [], organisationAuth: [] }];

const BusinessCategorySchema = z.enum(['fitness', 'real-estate', 'service-business', 'restaurant', 'haircut-and-salon']);
const ThemeFontSchema = z.enum(['sans', 'mono']);

// Known values as of 2026-09-10 — free-form/consumer-declared in theme-maker itself, not exhaustive.
const PageTypeSchema = z.enum([
    'default',
    'timetable',
    'available-on',
    'blocknote',
    'property-map-view',
    'agent-list',
    'property-search',
    'real-estate-home',
    'real-estate-agents',
    'real-estate-map-view',
    'real-estate-properties',
    'faq',
    'locations',
]);
// Reusability scope, not rendering behavior: "normal" = usable across multiple business categories,
// "feature" = exclusive to one business category. See PageRenderSchema below for rendering behavior.
const PageCategorySchema = z.enum(['normal', 'feature']);

const PageRenderSchema = z.enum(['csr', 'ssr', 'hybrid']);

// Which regeneration Lambda handles this page's publish step, grouped by content shape (e.g.
// 'blocknote-singleton' serves any page whose content is one BlockNote document). null = no
// generator wired up yet.
const PageGeneratorSchema = z.enum(['blocknote-singleton']).nullable();

const PageSchema = z.object({
    id: z.string(),
    name: z.string(),
    pageType: PageTypeSchema,
    pageCategory: PageCategorySchema,
    render: PageRenderSchema,
    generator: PageGeneratorSchema,
});

const TemplateSchema = z.object({
    uuid: z.string().uuid(),
    name: z.string(),
    business_category: BusinessCategorySchema,
    preview_image: z.string(),
    created_at: z.string().datetime(),
    // Optional: existing catalogue rows predate this field and have no `pages` attribute at all yet.
    pages: z.array(PageSchema).optional(),
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
