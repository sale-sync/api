// The affiliate programme rules (set by the founders 2026-11-24; backlog affiliate-programme, plan "Commission and trial").
// The same rules drive platform/apps/affiliate/src/lib/mock.ts; when the app calls this API the numbers come from here.
//
// - two markets, an affiliate is in exactly one: trade business in Australia (main), real estate in Thailand
// - clients pay for 6, 12 or 24 months only; the affiliate earns 4%, 8% or 16% of that subscription, once per client
//   (renewals do not earn), on the full price unless the promo code's flag says the discounted price
// - nothing is earned during the free trial (TRIAL_DAYS, may become 28); earned when the client moves to a paid plan.
//   That step is automatic today and will become a Silas admin approval: the "pending" status covers both
// - currency follows the market (AUD, THB); payouts are monthly, minimum US$ 100, the balance converted at an
//   approximate rate from our own rate service (not built yet: USD_RATE is a stand-in)
// - payout by Stripe or by a manual bank transfer from the company account (needs the recipient's bank details)

export type Market = 'australia' | 'thailand';
export type Plan = 6 | 12 | 24;
export type Channel = 'tiktok' | 'youtube' | 'instagram' | 'facebook' | 'line' | 'newsletter' | 'other';
export type ReferralStatus = 'trial' | 'pending' | 'subscribed' | 'ended';
export type Stage = 'pending' | 'approved' | 'refused'; // the team reviews every application (team portal)
export const STAGES: Stage[] = ['pending', 'approved', 'refused'];

export const MARKETS: Market[] = ['australia', 'thailand'];
export const PLANS: Plan[] = [6, 12, 24];
export const CHANNELS: Channel[] = ['tiktok', 'youtube', 'instagram', 'facebook', 'line', 'newsletter', 'other'];
export const RATES: Record<Plan, number> = { 6: 0.04, 12: 0.08, 24: 0.16 };
export const TRIAL_DAYS = 14;
export const MIN_PAYOUT_USD = 100;
export const PAYOUT_PERIOD = 'monthly';
export const CURRENCY: Record<Market, 'AUD' | 'THB'> = { australia: 'AUD', thailand: 'THB' };
export const LINK_BASE = 'https://silastech.co/r/';

/** Stand-in for our own rate service (not built yet): 1 unit of the currency in USD, approximate. */
const USD_RATE: Record<'AUD' | 'THB', number> = { AUD: 0.65, THB: 0.028 };
/** Sample subscription prices per plan, in the market currency (mock only; real prices come from payments). */
export const SAMPLE_PRICE: Record<Market, Record<Plan, number>> = {
    australia: { 6: 594, 12: 1188, 24: 2376 },
    thailand: { 6: 11880, 12: 23760, 24: 47520 },
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Commission on one subscription: the rate of its plan, on the price it was paid at. */
export const commission = (plan: Plan, price: number) => round2(price * RATES[plan]);
export const toUsd = (market: Market, amount: number) => round2(amount * USD_RATE[CURRENCY[market]]);

/** Days of the free trial left for a business that signed up on `signedUp`, as of `today`. */
export function trialDaysLeft(signedUp: string, today: Date, trialDays = TRIAL_DAYS): number {
    const days = Math.round((today.getTime() - new Date(signedUp).getTime()) / 86400000);
    return Math.max(0, trialDays - days);
}

export const isMarket = (v: unknown): v is Market => v === 'australia' || v === 'thailand';
export const isStatus = (v: unknown): v is ReferralStatus => v === 'trial' || v === 'pending' || v === 'subscribed' || v === 'ended';

/** Commission of one referral: only once it is subscribed, at its plan's rate on its commission base. Renewals never add more. */
export const referralCommission = (r: { status: ReferralStatus; plan?: Plan; commissionBase?: number }) =>
    r.status === 'subscribed' && r.plan && r.commissionBase ? commission(r.plan, r.commissionBase) : 0;
