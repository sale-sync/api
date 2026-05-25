import { DTO } from '@devyethiha/samjs';
import { z } from 'zod';

// ─── Shared Schemas ───────────────────────────

const fieldRuleSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('min_length'), value: z.number() }),
    z.object({ type: z.literal('max_length'), value: z.number() }),
    z.object({ type: z.literal('pattern'), value: z.instanceof(RegExp), message: z.string().optional() }),
    z.object({ type: z.literal('min'), value: z.number() }),
    z.object({ type: z.literal('max'), value: z.number() }),
]);

const fieldTypeSchema = z.enum([
    'single_line_text',
    'multi_line_text',
    'rich_text',
    'number_integer',
    'number_decimal',
    'boolean',
    'date',
    'date_time',
    'url',
    'color',
]);

const metaFieldSchema = z.object({
    key: z.string().min(1, 'Field key is required'),
    name: z.string().min(1, 'Field name is required'),
    field_type: fieldTypeSchema,
    description: z.string().optional(),
    required: z.boolean().optional(),
    rules: z.array(fieldRuleSchema).optional(),
});

const metaObjectSchema = z.object({
    fields: z.array(metaFieldSchema).min(1, 'meta_object must have at least one field'),
});

const blockDataSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));

// ─── Create ───────────────────────────────────

export const createBlockSchema = z.object({
    title: z.string().min(1, 'Title is required'),
    data: blockDataSchema,
    draft: blockDataSchema.optional().nullable(),
    meta_object: metaObjectSchema,
});

export type CreateBlockDto = z.infer<typeof createBlockSchema>;

export class CreateBlockDTO extends DTO<typeof createBlockSchema> {
    constructor() {
        super(createBlockSchema);
    }
}

// ─── Update ───────────────────────────────────

export const updateBlockSchema = z.object({
    title: z.string().min(1).optional(),
    data: blockDataSchema.optional(),
    draft: blockDataSchema.optional(),
    meta_object: metaObjectSchema.optional(),
});

export type UpdateBlockDto = z.infer<typeof updateBlockSchema>;

export class UpdateBlockDTO extends DTO<typeof updateBlockSchema> {
    constructor() {
        super(updateBlockSchema);
    }
}

// ─── Validate single (dry-run) ────────────────

export const validateBlockSchema = z.object({
    id: z.string().min(1, 'Block ID is required'),
    title: z.string().min(1, 'Title is required'),
    data: blockDataSchema,
    draft: blockDataSchema.optional().nullable(),
    meta_object: metaObjectSchema,
});

export type ValidateBlockDto = z.infer<typeof validateBlockSchema>;

export class ValidateBlockDTO extends DTO<typeof validateBlockSchema> {
    constructor() {
        super(validateBlockSchema);
    }
}

// ─── Validate batch (dry-run) ─────────────────
// z.array() is not a ZodObject so it cannot be wrapped in DTO
// Use validateBatchSchema.parse() directly in the controller

export const validateBatchSchema = z.array(validateBlockSchema).min(1, 'At least one block is required');

export type ValidateBatchDto = z.infer<typeof validateBatchSchema>;
