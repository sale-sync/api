// libs/shared/src/types/contact-form.ts
// The Contact Us page's dynamic form and its submissions (the web-app's Inbox). Added 2026-10-14, see
// backlogs/contact-form-mutation. Every organisation has its own form definition and its own
// submissions: both live in the organisation table under that org's partition (PK=ORG#{orgUuid}).
//
//   form definition  SK=CONTACT_FORM                       singleton, live on save (no draft/publish)
//   submission       SK=CONTACT_SUBMISSION#{submissionId}  one item per submit
//
// Not to be confused with types/contact.ts (CRM contacts) or types/form.ts (an older, unused form
// model), nor with ContactRecord (the Contact page's title/subtitle/business info, SK=CONTACT).

export type ContactFormFieldType = 'phone' | 'text' | 'email' | 'textarea' | 'select' | 'price';

type ContactFormFieldBase = {
    id: string; // stable key of the field, unique within the form; submission values are keyed by it
    label: string;
    placeholder?: string;
    required: boolean;
};

export type ContactFormPhoneField = ContactFormFieldBase & { type: 'phone' };
export type ContactFormTextField = ContactFormFieldBase & { type: 'text'; inputType: 'string' | 'number' };
export type ContactFormEmailField = ContactFormFieldBase & { type: 'email' };
export type ContactFormTextareaField = ContactFormFieldBase & { type: 'textarea' };
export type ContactFormSelectField = ContactFormFieldBase & { type: 'select'; options: string[] };
// An amount plus a currency the visitor picks from CONTACT_FORM_CURRENCIES (dtos/contact-form.ts).
export type ContactFormPriceField = ContactFormFieldBase & { type: 'price' };

export type ContactFormField =
    | ContactFormPhoneField
    | ContactFormTextField
    | ContactFormEmailField
    | ContactFormTextareaField
    | ContactFormSelectField
    | ContactFormPriceField;

// The stored record. `updated_at` is null while the org is still on the default form.
export type ContactFormRecord = {
    fields: ContactFormField[];
    updated_at: string | null;
};

// What mutation-api's GET /contacts returns to a client site: the form plus the defaults its phone
// and price fields start on, derived from the org's market (never stored). The visitor can change
// both. `dialCode` alone was the first version's shape and is kept for pages built against it.
export type PublicContactForm = {
    fields: ContactFormField[];
    dialCode: string;
    country: string; // ISO 3166-1 alpha-2, the phone fields' default country
    currency: string; // the price fields' default currency
};

// One answered field. `label` and `type` are a snapshot of the form at submit time, so renaming or
// removing a field later never changes or hides an older submission.
export type ContactSubmissionValue = {
    field_id: string;
    label: string;
    type: ContactFormFieldType;
    value: string;
};

export type ContactSubmission = {
    id: string; // `${submitted_at}_${uuid}` — sorts by time, and is the tail of the item's SK
    org_uuid: string;
    submitted_at: string; // ISO string
    read: boolean;
    values: ContactSubmissionValue[];
};

export type ContactSubmissionList = {
    items: ContactSubmission[];
    next_cursor: string | null; // id of the last item returned; pass it back as `cursor` for the next page
};
