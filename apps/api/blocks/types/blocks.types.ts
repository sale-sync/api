export type FieldType =
    | 'single_line_text'
    | 'multi_line_text'
    | 'rich_text'
    | 'number_integer'
    | 'number_decimal'
    | 'boolean'
    | 'date'
    | 'date_time'
    | 'url'
    | 'color';

export type FieldTypeValueMap = {
    single_line_text: string;
    multi_line_text: string;
    rich_text: string;
    number_integer: number;
    number_decimal: number;
    boolean: boolean;
    date: string;
    date_time: string;
    url: string;
    color: string;
};

export type FieldValue = FieldTypeValueMap[FieldType];

// ─── Simplified to plain discriminated union ──
// Conditional generic removed — Zod inference now aligns with this type

export type FieldRule =
    | { type: 'min_length'; value: number }
    | { type: 'max_length'; value: number }
    | { type: 'pattern'; value: RegExp; message?: string }
    | { type: 'min'; value: number }
    | { type: 'max'; value: number };

export type MetaField = {
    key: string;
    name: string;
    field_type: FieldType;
    description?: string;
    required?: boolean;
    rules?: FieldRule[];
};

export type MetaObject = {
    fields: MetaField[];
};

export type BlockData = Record<string, FieldValue>;

export type Block = {
    id: string;
    title: string;
    data: BlockData;
    draft: BlockData | null;
    meta_object: MetaObject;
};

// ─── Validation types ─────────────────────────

export type ValidationError = {
    key: string;
    message: string;
};

export type ValidationResult = { valid: true } | { valid: false; errors: ValidationError[] };

export type BlockValidationResult = { index: number; block: Block } & ValidationResult;

export type BatchValidationResult =
    | { valid: true; results: BlockValidationResult[] }
    | { valid: false; results: BlockValidationResult[]; total_errors: number };

// ─── Field type validators ────────────────────

export const fieldTypeValidators: Record<FieldType, (value: unknown) => boolean> = {
    single_line_text: (v) => typeof v === 'string' && !v.includes('\n'),
    multi_line_text: (v) => typeof v === 'string',
    rich_text: (v) => typeof v === 'string',
    number_integer: (v) => typeof v === 'number' && Number.isInteger(v),
    number_decimal: (v) => typeof v === 'number' && isFinite(v),
    boolean: (v) => typeof v === 'boolean',
    date: (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v),
    date_time: (v) => typeof v === 'string' && !isNaN(Date.parse(v)),
    url: (v) => {
        try {
            new URL(v as string);
            return true;
        } catch {
            return false;
        }
    },
    color: (v) => typeof v === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v),
};

// ─── Rule engine ──────────────────────────────

function applyRules(key: string, value: FieldValue, rules: FieldRule[]): ValidationError[] {
    const errors: ValidationError[] = [];
    for (const rule of rules) {
        switch (rule.type) {
            case 'min_length':
                if (typeof value === 'string' && value.length < rule.value)
                    errors.push({ key, message: `'${key}' must be at least ${rule.value} characters.` });
                break;
            case 'max_length':
                if (typeof value === 'string' && value.length > rule.value)
                    errors.push({ key, message: `'${key}' must be at most ${rule.value} characters.` });
                break;
            case 'pattern':
                if (typeof value === 'string' && !rule.value.test(value))
                    errors.push({ key, message: rule.message ?? `'${key}' does not match the required pattern.` });
                break;
            case 'min':
                if (typeof value === 'number' && value < rule.value)
                    errors.push({ key, message: `'${key}' must be at least ${rule.value}.` });
                break;
            case 'max':
                if (typeof value === 'number' && value > rule.value)
                    errors.push({ key, message: `'${key}' must be at most ${rule.value}.` });
                break;
        }
    }
    return errors;
}

// ─── validateBlock ────────────────────────────

export function validateBlock(data: BlockData, meta_object: MetaObject): ValidationResult {
    const errors: ValidationError[] = [];

    for (const field of meta_object.fields) {
        const value = data[field.key];
        const isMissing = value === undefined || value === null;

        if (isMissing) {
            if (field.required) errors.push({ key: field.key, message: `"${field.key}" is required.` });
            continue;
        }

        const isValidType = fieldTypeValidators[field.field_type](value);
        if (!isValidType) {
            errors.push({
                key: field.key,
                message: `"${field.key}" expected type "${field.field_type}" but received an invalid value.`,
            });
            continue;
        }

        if (field.rules?.length) {
            errors.push(...applyRules(field.key, value, field.rules));
        }
    }

    const knownKeys = new Set(meta_object.fields.map((f) => f.key));
    for (const key of Object.keys(data)) {
        if (!knownKeys.has(key)) errors.push({ key, message: `"${key}" is not defined in the meta_object.` });
    }

    return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

// ─── validateBlocks ───────────────────────────

export function validateBlocks(blocks: Block[]): BatchValidationResult {
    const results: BlockValidationResult[] = blocks.map((block, index) => {
        const result = validateBlock(block.data, block.meta_object);
        return { index, block, ...result };
    });

    const totalErrors = results
        .filter((r): r is BlockValidationResult & { valid: false; errors: ValidationError[] } => !r.valid)
        .reduce((sum, r) => sum + r.errors.length, 0);

    return totalErrors === 0 ? { valid: true, results } : { valid: false, results, total_errors: totalErrors };
}
