// libs/shared/src/dtos/contact-form.ts
// Validation for the Contact Us page's dynamic form (see types/contact-form.ts and
// backlogs/contact-form-mutation). Two layers:
//   - UpdateContactFormSchema validates the form *definition* an org saves from the web-app.
//   - buildContactSubmissionSchema(fields) builds, from a stored definition, the schema a visitor's
//     *submission* must satisfy. mutation-api validates every POST with it; the client site applies the
//     same rules in the browser, but that is only for UX — the server never trusts it.
import { z } from 'zod';
import { MARKET_CURRENCY, type Market } from '../types/organisation';
import { DIAL_CODES } from '../utils/dial-codes';
import type { ContactFormField, ContactSubmissionValue } from '../types/contact-form';

export const CONTACT_FORM_MAX_FIELDS = 20;
export const CONTACT_FORM_MAX_OPTIONS = 30;

// Upper bounds on what a visitor may send per field type.
export const CONTACT_FORM_VALUE_MAX_LENGTH = {
    phone: 20,
    text: 200,
    email: 254,
    textarea: 5000,
    select: 100,
    price: 40,
} as const;

// The currencies a price field offers, in this order (confirmed with the user 2026-10-14: a fixed
// list, not chosen per field). The default is the org market's currency.
export const CONTACT_FORM_CURRENCIES = ['THB', 'AUD', 'USD', 'EUR', 'GBP', 'CNY', 'SGD', 'MMK'] as const;

export function currencyForMarket(market: Market | undefined | null): string {
    return MARKET_CURRENCY[market ?? DEFAULT_DIAL_MARKET] ?? MARKET_CURRENCY[DEFAULT_DIAL_MARKET];
}

// Launch markets only (docs/api/market-behaviour.md). Same map publish-contact-page bakes from.
export const MARKET_DIAL_CODE: Record<Market, string> = { TH: '+66', AU: '+61' };
export const DEFAULT_DIAL_MARKET: Market = 'TH';

export function dialCodeForMarket(market: Market | undefined | null): string {
    return MARKET_DIAL_CODE[market ?? DEFAULT_DIAL_MARKET] ?? MARKET_DIAL_CODE[DEFAULT_DIAL_MARKET];
}

const fieldBase = {
    id: z
        .string()
        .trim()
        .min(1, 'field id is required')
        .max(40, 'field id must be 40 characters or fewer')
        .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, 'field id must start with a letter and use only letters, numbers, - and _')
        // Submission values are a plain object keyed by field id, so an id must never be the name of
        // something every object already has (constructor, toString, ...).
        .refine((id) => !(id in Object.prototype), { message: 'field id is a reserved word' }),
    label: z.string().trim().min(1, 'label is required').max(100, 'label must be 100 characters or fewer'),
    placeholder: z.string().trim().max(100, 'placeholder must be 100 characters or fewer').optional(),
    required: z.boolean(),
};

const optionSchema = z
    .string()
    .trim()
    .min(1, 'option must not be empty')
    .max(CONTACT_FORM_VALUE_MAX_LENGTH.select, `option must be ${CONTACT_FORM_VALUE_MAX_LENGTH.select} characters or fewer`);

export const ContactFormFieldSchema = z.discriminatedUnion('type', [
    z.object({ ...fieldBase, type: z.literal('phone') }),
    z.object({ ...fieldBase, type: z.literal('text'), inputType: z.enum(['string', 'number']) }),
    z.object({ ...fieldBase, type: z.literal('email') }),
    z.object({ ...fieldBase, type: z.literal('textarea') }),
    z.object({ ...fieldBase, type: z.literal('price') }),
    z.object({
        ...fieldBase,
        type: z.literal('select'),
        options: z
            .array(optionSchema)
            .min(1, 'a select field needs at least one option')
            .max(CONTACT_FORM_MAX_OPTIONS, `a select field can have at most ${CONTACT_FORM_MAX_OPTIONS} options`)
            .refine((options) => new Set(options).size === options.length, {
                message: 'select options must be unique',
            }),
    }),
]);

export const UpdateContactFormSchema = z.object({
    fields: z
        .array(ContactFormFieldSchema)
        .min(1, 'the form needs at least one field')
        .max(CONTACT_FORM_MAX_FIELDS, `the form can have at most ${CONTACT_FORM_MAX_FIELDS} fields`)
        .refine((fields) => new Set(fields.map((field) => field.id)).size === fields.length, {
            message: 'field ids must be unique',
        }),
});

export type UpdateContactFormInput = z.infer<typeof UpdateContactFormSchema>;

// What every organisation starts with until it customises its own form: the five fields the Contact
// page shipped with as static markup (theme-maker ContactSlice), Subject options included.
export const DEFAULT_CONTACT_FORM_FIELDS: ContactFormField[] = [
    { id: 'name', type: 'text', inputType: 'string', label: 'Name', required: true },
    { id: 'email', type: 'email', label: 'Email address', required: true },
    { id: 'mobile', type: 'phone', label: 'Mobile number', required: false },
    {
        id: 'subject',
        type: 'select',
        label: 'Subject',
        required: true,
        options: ['General', 'Support', 'Feedback', 'Other'],
    },
    { id: 'description', type: 'textarea', label: 'Description', required: true },
];

// A national number as a visitor types it: digits, optionally grouped with spaces or dashes.
const PHONE_PATTERN = /^[0-9][0-9 -]{4,18}[0-9]$/;
// A phone value is sent as "<dial code> <national number>", e.g. "+95 9 123 456 789", with the dial
// code the visitor picked. A bare national number (pages built before the country picker) is still
// accepted and gets the org market's dial code.
const PHONE_WITH_CODE = /^(\+\d{1,4}) (.+)$/;
const NUMBER_PATTERN = /^-?\d+(\.\d+)?$/;
// A price value is sent as "<currency> <amount>", e.g. "THB 3500000" or "USD 1,250.50": a positive
// amount, thousands separators allowed, at most two decimals.
const PRICE_PATTERN = /^([A-Z]{3}) (\d{1,3}(,\d{3})*|\d+)(\.\d{1,2})?$/;

function isValidPhone(value: string): boolean {
    const match = PHONE_WITH_CODE.exec(value);
    if (!match) return PHONE_PATTERN.test(value);
    return DIAL_CODES.has(match[1]) && PHONE_PATTERN.test(match[2]);
}

function isValidPrice(value: string): boolean {
    const match = PRICE_PATTERN.exec(value);
    if (!match) return false;
    const digits = value.slice(4).replace(/,/g, '').split('.')[0];
    return (CONTACT_FORM_CURRENCIES as readonly string[]).includes(match[1]) && digits.replace(/^0+/, '').length <= 15;
}

function valueSchemaFor(field: ContactFormField) {
    const max = CONTACT_FORM_VALUE_MAX_LENGTH[field.type];
    const required = `${field.label} is required`;
    // min(1) only bites for required fields: an optional field's '' is accepted before this schema
    // is tried (see buildContactSubmissionSchema).
    const base = z
        .string(required)
        .trim()
        .min(1, required)
        .max(max, `${field.label} must be ${max} characters or fewer`);

    switch (field.type) {
        case 'phone':
            return base.refine(isValidPhone, { message: `${field.label} must be a valid phone number` });
        case 'price':
            return base.refine(isValidPrice, {
                message: `${field.label} must be an amount with one of the listed currencies`,
            });
        case 'email':
            return base.email(`${field.label} must be a valid email address`);
        case 'select':
            return base.refine((value) => field.options.includes(value), {
                message: `${field.label} must be one of the listed options`,
            });
        case 'text':
            return field.inputType === 'number'
                ? base.regex(NUMBER_PATTERN, `${field.label} must be a number`)
                : base;
        case 'textarea':
            return base;
    }
}

// Strict object keyed by field id: unknown keys are rejected, a required field must be a non-empty
// string, and an optional field may be omitted or sent as ''.
export function buildContactSubmissionSchema(fields: ContactFormField[]) {
    const shape: Record<string, z.ZodType<string | undefined>> = {};
    for (const field of fields) {
        const value = valueSchemaFor(field);
        shape[field.id] = field.required ? value : z.union([z.string().trim().length(0), value]).optional();
    }
    return z.strictObject(shape);
}

// Turns validated input into what is stored: one entry per form field (in form order) carrying the
// label/type snapshot. Unanswered optional fields are kept as '' so the Inbox shows the full form as
// it was at submit time. A phone value keeps the dial code the visitor picked (or gets the org's, for
// a bare number); a price is stored with thousands separators, e.g. "THB 3,500,000".
function storedValue(field: ContactFormField, raw: string, dialCode: string): string {
    if (!raw) return raw;
    if (field.type === 'phone') {
        return PHONE_WITH_CODE.test(raw) ? raw.replace(/\s+/g, ' ') : `${dialCode} ${raw}`;
    }
    if (field.type === 'price') {
        const [currency, amount] = [raw.slice(0, 3), raw.slice(4).replace(/,/g, '')];
        const [whole, fraction] = amount.split('.');
        const grouped = whole.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return `${currency} ${grouped}${fraction ? `.${fraction}` : ''}`;
    }
    return raw;
}

export function toContactSubmissionValues(
    fields: ContactFormField[],
    input: Record<string, string | undefined>,
    dialCode: string,
): ContactSubmissionValue[] {
    return fields.map((field) => {
        const raw = (Object.prototype.hasOwnProperty.call(input, field.id) ? input[field.id] ?? '' : '').trim();
        return { field_id: field.id, label: field.label, type: field.type, value: storedValue(field, raw, dialCode) };
    });
}

// ─── Inbox (web-app, via api/apps/api/organisation's /organisations/inbox) ──────────────────────────

export const CONTACT_INBOX_DEFAULT_LIMIT = 20;
export const CONTACT_INBOX_MAX_LIMIT = 50;

// A submission id is `${ISO submit time}_${uuid}` (see ContactSubmission). Checked before an id from
// the query string is ever put into a table key.
export const CONTACT_SUBMISSION_ID_PATTERN =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const submissionIdSchema = z.string().regex(CONTACT_SUBMISSION_ID_PATTERN, 'invalid submission id');

// Query string of GET /organisations/inbox. Everything arrives as a string.
export const ListContactSubmissionsQuerySchema = z.object({
    limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(CONTACT_INBOX_MAX_LIMIT, `limit must be ${CONTACT_INBOX_MAX_LIMIT} or fewer`)
        .default(CONTACT_INBOX_DEFAULT_LIMIT),
    cursor: submissionIdSchema.optional(),
    q: z.string().trim().max(100, 'search text must be 100 characters or fewer').optional(),
});

export type ListContactSubmissionsQuery = z.infer<typeof ListContactSubmissionsQuerySchema>;

export const ContactSubmissionIdQuerySchema = z.object({ id: submissionIdSchema });

export const UpdateContactSubmissionSchema = z.object({ read: z.boolean() });

export type UpdateContactSubmissionInput = z.infer<typeof UpdateContactSubmissionSchema>;
