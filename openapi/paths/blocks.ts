import { z } from 'zod';

const security: Array<Record<string, string[]>> = [{ bearerAuth: [] }, { organisationAuth: [] }];

const BlockSchema = z.object({
    id: z.string(),
    organisation_id: z.string(),
    title: z.string(),
    data: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    draft: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).nullable(),
    meta_object: z.object({ fields: z.array(z.object({ key: z.string(), name: z.string() })) }),
    created_at: z.string(),
    updated_at: z.string(),
});

const ValidationResultSchema = z.object({
    valid: z.boolean(),
    errors: z
        .array(z.object({ field: z.string(), message: z.string() }))
        .optional()
        .meta({ description: 'Populated when valid is false' }),
});

// Doc-friendly block data schemas (instanceof(RegExp) cannot be represented in OpenAPI)
const fieldRuleDoc = z.discriminatedUnion('type', [
    z.object({ type: z.literal('min_length'), value: z.number() }),
    z.object({ type: z.literal('max_length'), value: z.number() }),
    z.object({ type: z.literal('pattern'), value: z.string(), message: z.string().optional() }),
    z.object({ type: z.literal('min'), value: z.number() }),
    z.object({ type: z.literal('max'), value: z.number() }),
]);

const metaFieldDoc = z.object({
    key: z.string(),
    name: z.string(),
    field_type: z.enum([
        'single_line_text', 'multi_line_text', 'rich_text',
        'number_integer', 'number_decimal', 'boolean',
        'date', 'date_time', 'url', 'color',
    ]),
    description: z.string().optional(),
    required: z.boolean().optional(),
    rules: z.array(fieldRuleDoc).optional(),
});

const blockDataDoc = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));

const updateBlockDoc = z.object({
    title: z.string().optional(),
    data: blockDataDoc.optional(),
    draft: blockDataDoc.optional(),
    meta_object: z.object({ fields: z.array(metaFieldDoc) }).optional(),
});

const createBlockDoc = z.object({
    title: z.string().meta({ description: 'Block title' }),
    data: blockDataDoc,
    draft: blockDataDoc.optional().nullable(),
    meta_object: z.object({ fields: z.array(metaFieldDoc).min(1) }),
});

const validateBlockDoc = createBlockDoc.extend({
    id: z.string().meta({ description: 'Block ID (required for validation)' }),
});

export const blocksPaths = {
    '/blocks': {
        get: {
            tags: ['Blocks'],
            summary: 'List blocks or get/validate a single block',
            security,
            requestParams: {
                query: z.object({
                    id: z.string().optional().meta({ description: 'Block ID — omit to list all' }),
                    validate: z
                        .literal('true')
                        .optional()
                        .meta({ description: 'Dry-run validate the block (requires id)' }),
                }),
            },
            responses: {
                '200': {
                    description: 'Block list, single block, or validation result',
                    content: {
                        'application/json': {
                            schema: z.union([z.array(BlockSchema), BlockSchema, ValidationResultSchema]),
                        },
                    },
                },
                '401': { description: 'Unauthorized' },
                '403': { description: 'No organisation context' },
                '404': { description: 'Block not found' },
            },
        },
        post: {
            tags: ['Blocks'],
            summary: 'Create a block, or dry-run validate one or many',
            security,
            requestParams: {
                query: z.object({
                    validate: z
                        .enum(['true', 'batch'])
                        .optional()
                        .meta({ description: '"true" — validate single; "batch" — validate array' }),
                }),
            },
            requestBody: {
                content: {
                    'application/json': {
                        schema: z.union([createBlockDoc, validateBlockDoc, z.array(validateBlockDoc)]).meta({
                            description: 'Create payload or validation payload',
                        }),
                    },
                },
            },
            responses: {
                '200': {
                    description: 'Validation result (when ?validate is set)',
                    content: { 'application/json': { schema: ValidationResultSchema } },
                },
                '201': {
                    description: 'Block created',
                    content: { 'application/json': { schema: BlockSchema } },
                },
                '400': { description: 'Validation error' },
                '401': { description: 'Unauthorized' },
                '403': { description: 'No organisation context' },
                '422': { description: 'Dry-run validation failed — block data is invalid' },
            },
        },
        put: {
            tags: ['Blocks'],
            summary: 'Update a block',
            security,
            requestParams: {
                query: z.object({
                    id: z.string().meta({ description: 'Block ID to update' }),
                }),
            },
            requestBody: {
                content: {
                    'application/json': { schema: updateBlockDoc },
                },
            },
            responses: {
                '200': {
                    description: 'Block updated',
                    content: { 'application/json': { schema: BlockSchema } },
                },
                '400': { description: 'Missing id or validation error' },
                '401': { description: 'Unauthorized' },
                '403': { description: 'No organisation context' },
            },
        },
        delete: {
            tags: ['Blocks'],
            summary: 'Delete a block',
            security,
            requestParams: {
                query: z.object({
                    id: z.string().meta({ description: 'Block ID to delete' }),
                }),
            },
            responses: {
                '204': { description: 'Block deleted' },
                '400': { description: 'Missing id' },
                '401': { description: 'Unauthorized' },
                '403': { description: 'No organisation context' },
            },
        },
    },
};
