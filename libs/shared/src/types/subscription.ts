export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled';

export type PaymentMethod = 'bank_transfer' | 'stripe';

// An organisation's relationship with Sale Sync: trial window, plan, and current payment state.
// One singleton record per organisation — PK=ORG#{organisation_id}, SK=SUBSCRIPTION.
export type Subscription = {
    uuid: string;
    organisation_id: string;
    plan_id: string;
    trial_start: string;
    trial_end: string;
    status: SubscriptionStatus;
    payment_method: PaymentMethod | null;
    activated_by: string | null; // staff user id who last reactivated it (manual payment recorded)
    activated_at: string | null;
    promo_code: string | null; // code redeemed at signup, if any — set regardless of code type, for audit/display
    discount_type: 'percentage' | 'flat_amount' | null; // null if no code redeemed, or the redeemed code was a trial extension (no cost discount)
    discount_value: number | null;
    created_at: string;
    updated_at: string;
};
