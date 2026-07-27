import type { BrandingColor, BusinessCategory, ThemeFont } from './organisation';

export type Template = {
    uuid: string;
    name: string;
    business_category: BusinessCategory;
    preview_image: string;
    created_at: string;
};

export type OrganisationTemplate = {
    template_uuid: string;
    added_at: string;
};

// Staff-curated color-palette + font preset, scoped to exactly one template. An organisation's own
// theme (its BrandingRecord) is created by deep-copying one of these at org-creation time — editing
// the org's copy afterward never affects the predefined theme it was copied from. Stored in
// WebsiteTable: PK=TEMPLATE#<uuid>, SK=THEME#<uuid>. See backlogs/website/children/
// website-table-templates-themes for the full design history.
export type PredefinedTheme = {
    uuid: string;
    template_uuid: string;
    name: string;
    primaryColor: BrandingColor;
    secondaryColor: BrandingColor;
    font: ThemeFont;
    created_at: string;
};
