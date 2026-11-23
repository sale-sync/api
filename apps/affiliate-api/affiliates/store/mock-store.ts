// MOCK STORE: in-memory data, no DynamoDB yet (backlog affiliate-api; the user decided 2026-11-24 to build the API on mock
// data first). Every service reads and writes through this one module, so the DynamoDB version replaces this file, not the
// services. Writes live only as long as the Lambda instance (a cold start resets to the seed below).
//
// Seed: the same two sample affiliates the app's mock uses (platform/apps/affiliate/src/lib/mock.ts), keyed by the user id
// (the `sub` of the ID token in the Identifier cookie, as Cognito will issue it). Any other user id has no affiliate yet and
// starts with an application.
import type { Channel, Market, Plan, ReferralStatus, Stage } from '../domain/rules';

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

type Db = { affiliates: Map<string, Affiliate>; links: AffLink[]; referrals: Referral[]; payouts: Map<string, PayoutMethod> };

function seed(): Db {
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

let db: Db = seed();
let counter = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

/** Back to the seed (tests). */
export function resetMockStore(): void {
    db = seed();
}

export const store = {
    getAffiliate: async (userId: string) => db.affiliates.get(userId) ?? null,
    putAffiliate: async (a: Affiliate) => {
        db.affiliates.set(a.userId, a);
        return a;
    },
    listLinks: async (userId: string) => db.links.filter((l) => l.userId === userId),
    /** slugs are unique across every affiliate: a referral link must point at exactly one */
    slugTaken: async (slug: string) => db.links.some((l) => l.slug === slug),
    addLink: async (link: Omit<AffLink, 'id'>) => {
        const created = { ...link, id: nextId('link') };
        db.links.push(created);
        return created;
    },
    listReferrals: async (userId: string) => db.referrals.filter((r) => r.userId === userId),
    getPayoutMethod: async (userId: string): Promise<PayoutMethod> => db.payouts.get(userId) ?? { kind: 'none' },
    putPayoutMethod: async (userId: string, m: PayoutMethod) => {
        db.payouts.set(userId, m);
        return m;
    },
};
