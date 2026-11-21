export type PromoCodeType = 'percentage' | 'flat_amount' | 'trial_extension_days';

export type PromoCodeStatus = 'active' | 'disabled';

// A staff-created discount/trial-extension code an organisation can redeem at signup.
// Stored as flat top-level attributes (not a JSON `data` blob like Plan/Subscription) because
// redemption needs a native atomic ADD on redemption_count plus a ConditionExpression guarding
// status/expires_at/max_redemptions — DynamoDB can't condition or increment fields packed inside
// an opaque JSON string. PK=PROMO, SK=META#{uuid}.
export type PromoCode = {
    uuid: string;
    code: string; // stored uppercased for case-insensitive redemption lookups
    type: PromoCodeType;
    value: number; // percentage (0-100], currency amount, or whole days — meaning depends on type
    max_redemptions: number | null; // null = unlimited distinct orgs
    redemption_count: number; // starts 0, incremented atomically on redemption
    expires_at: string | null; // ISO 8601, null = never expires
    status: PromoCodeStatus;
    created_by: string; // staff Cognito sub
    created_at: string;
    updated_at: string;
};
