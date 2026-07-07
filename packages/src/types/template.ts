import type { BusinessCategory } from './organisation';

export type ThemeBrandColor = 'red' | 'orange' | 'blue' | 'purple' | 'green' | 'amber' | 'gray' | 'stone';

export type ThemeFont = 'sans' | 'mono';

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

export type ThemeConfig = {
    template_uuid: string;
    brand_color: ThemeBrandColor;
    font: ThemeFont;
    updated_at: string;
};
