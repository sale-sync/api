// Sample data of the affiliate API, keyed by user id (the `sub` of the ID token). Used by the in-memory store (tests) and
// written to DynamoDB the first time a sample affiliate is requested (dynamo-store.ts). The same people and numbers as the
// app's browser mock (platform/apps/affiliate/src/lib/mock.ts).
import type { Channel, Market, Plan, ReferralStatus, Stage } from './rules';

export type Affiliate = {
    userId: string;
    market: Market; // fixed once the application is sent
    stage: Stage;
    first: string;
    last: string;
    email: string;
    phone: string;
    reach: string;
    channelUrl: string;
    plan: string;
    appliedOn: string;
    /** set by the team review (reviews Lambda): when, by whom (a team email, never shown to the affiliate), and why not */
    reviewedOn?: string;
    reviewedBy?: string;
    refusalReason?: string;
};
export type AffLink = { id: string; userId: string; channel: Channel; name: string; slug: string; clicks: number; createdOn: string };
export type Referral = {
    id: string;
    userId: string;
    business: string;
    linkId: string;
    signedUp: string;
    status: ReferralStatus;
    plan?: Plan;
    subscribedOn?: string;
    /** price the commission is worked out on: full price, or the discounted one when the promo code's flag says so */
    commissionBase?: number;
};
export type PayoutMethod =
    | { kind: 'none' }
    | { kind: 'stripe' }
    // bank details: the mock keeps only the last 4 digits of the account number; the real store must keep the full details protected
    | { kind: 'bank'; accountName: string; bank: string; branch: string; last4: string };

export const MOCK_JORDAN = 'mock-affiliate-jordan';
export const MOCK_PLOY = 'mock-affiliate-ploy';
/** "Today" for the mock, so trial days and dates stay stable in tests. */
export const MOCK_TODAY = new Date('2026-11-24T00:00:00Z');

export type Seed = { affiliates: Map<string, Affiliate>; links: AffLink[]; referrals: Referral[]; payouts: Map<string, PayoutMethod> };

/** The two sample affiliates (Jordan, Australia; Ploy, Thailand) with their links, referrals and payout method. */
export function seed(): Seed {
    const affiliates = new Map<string, Affiliate>([
        [MOCK_JORDAN, { userId: MOCK_JORDAN, market: 'australia', stage: 'approved', first: 'Jordan', last: 'Lee', email: 'jordan@jordanbuilds.com.au', phone: '+61 412 345 678', reach: 'creator', channelUrl: 'youtube.com/@jordanbuilds', plan: '', appliedOn: '2026-10-01' }],
        [MOCK_PLOY, { userId: MOCK_PLOY, market: 'thailand', stage: 'approved', first: 'Ploy', last: 'Chaiyaporn', email: 'ploy@ployproperty.co.th', phone: '+66 81 234 5678', reach: 'creator', channelUrl: '', plan: '', appliedOn: '2026-10-01' }],
    ]);
    const L = (userId: string, id: string, channel: Channel, name: string, slug: string, clicks: number): AffLink => ({ id, userId, channel, name, slug, clicks, createdOn: '2026-10-02' });
    const links = [
        L(MOCK_JORDAN, 'l1', 'youtube', 'YouTube channel', 'jordan-youtube', 612),
        L(MOCK_JORDAN, 'l2', 'tiktok', 'TikTok bio', 'jordan-tiktok', 1240),
        L(MOCK_JORDAN, 'l3', 'instagram', 'Instagram stories', 'jordan-insta', 188),
        L(MOCK_JORDAN, 'l4', 'newsletter', 'Monthly newsletter', 'jordan-news', 96),
        L(MOCK_PLOY, 'l5', 'line', 'LINE official account', 'ploy-line', 840),
        L(MOCK_PLOY, 'l6', 'facebook', 'Facebook page', 'ploy-facebook', 520),
        L(MOCK_PLOY, 'l7', 'tiktok', 'TikTok bio', 'ploy-tiktok', 310),
    ];
    const R = (userId: string, id: string, business: string, linkId: string, signedUp: string, status: ReferralStatus, plan?: Plan, subscribedOn?: string, commissionBase?: number): Referral => ({ id, userId, business, linkId, signedUp, status, plan, subscribedOn, commissionBase });
    const referrals = [
        R(MOCK_JORDAN, 'r1', 'Coastline Plumbing', 'l1', '2026-11-12', 'subscribed', 12, '2026-11-26', 1188),
        R(MOCK_JORDAN, 'r2', 'Bright Spark Electrical', 'l2', '2026-11-18', 'trial'),
        R(MOCK_JORDAN, 'r3', 'Northside Roofing', 'l1', '2026-11-03', 'subscribed', 24, '2026-11-17', 2376),
        R(MOCK_JORDAN, 'r4', 'Green Edge Landscaping', 'l4', '2026-11-06', 'pending'),
        R(MOCK_JORDAN, 'r5', 'Peak HVAC Services', 'l2', '2026-10-21', 'subscribed', 6, '2026-11-04', 594),
        R(MOCK_JORDAN, 'r6', 'Harbour Tiling', 'l1', '2026-10-15', 'ended'),
        R(MOCK_JORDAN, 'r7', 'Bayview Electrical', 'l4', '2026-10-15', 'subscribed', 12, '2026-10-29', 1188),
        R(MOCK_JORDAN, 'r8', 'Summit Carpentry', 'l2', '2026-11-20', 'trial'),
        R(MOCK_JORDAN, 'r9', 'Redgum Fencing', 'l3', '2026-11-21', 'trial'),
        R(MOCK_PLOY, 'r10', 'Siam Riverside Realty', 'l5', '2026-11-08', 'subscribed', 12, '2026-11-22', 23760),
        R(MOCK_PLOY, 'r11', 'Chiang Mai Homes', 'l6', '2026-11-19', 'trial'),
        R(MOCK_PLOY, 'r12', 'Phuket Coast Property', 'l5', '2026-11-02', 'pending'),
        R(MOCK_PLOY, 'r13', 'Bangkok Urban Living', 'l7', '2026-10-18', 'subscribed', 6, '2026-11-01', 11880),
    ];
    const payouts = new Map<string, PayoutMethod>([
        [MOCK_JORDAN, { kind: 'bank', accountName: 'Jordan Lee', bank: 'Commonwealth Bank', branch: '062-000', last4: '4821' }],
        [MOCK_PLOY, { kind: 'none' }],
    ]);
    return { affiliates, links, referrals, payouts };
}

