// In-memory store, for the unit tests (AFFILIATE_STORE=memory). Writes live as long as the process.
import { AlreadyAppliedError, SlugTakenError } from '../services/errors';
import { seed, type AffLink, type Seed } from './seed';
import type { AffiliateStore } from './types';

let db: Seed = seed();
let counter = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

/** Back to the seed (tests). */
export function resetMemoryStore(): void {
    db = seed();
}

export const memoryStore: AffiliateStore = {
    getAffiliate: async (userId) => db.affiliates.get(userId) ?? null,
    createAffiliate: async (a) => {
        if (db.affiliates.has(a.userId)) throw new AlreadyAppliedError();
        db.affiliates.set(a.userId, a);
        return a;
    },
    putAffiliate: async (a) => {
        db.affiliates.set(a.userId, a);
        return a;
    },
    listLinks: async (userId) => db.links.filter((l) => l.userId === userId),
    addLink: async (link) => {
        if (db.links.some((l) => l.slug === link.slug)) throw new SlugTakenError(link.slug);
        const created: AffLink = { ...link, id: nextId('link') };
        db.links.push(created);
        return created;
    },
    listReferrals: async (userId) => db.referrals.filter((r) => r.userId === userId),
    getPayoutMethod: async (userId) => db.payouts.get(userId) ?? { kind: 'none' },
    putPayoutMethod: async (userId, m) => {
        db.payouts.set(userId, m);
        return m;
    },
};
