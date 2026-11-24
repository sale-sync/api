// The store the services use. Deployed: DynamoDB, table from AFFILIATE_TABLE_NAME, required (no fallback: staging and
// production are different tables, and a missing name must fail loudly, never write somewhere else). Unit tests set
// AFFILIATE_STORE=memory for the in-memory store.
import { createDynamoStore } from './dynamo-store';
import { memoryStore } from './memory-store';
import type { AffiliateStore } from './types';

let current: AffiliateStore | null = null;

function pick(): AffiliateStore {
    if (process.env.AFFILIATE_STORE === 'memory') return memoryStore;
    const table = process.env.AFFILIATE_TABLE_NAME;
    if (!table) throw new Error('AFFILIATE_TABLE_NAME environment variable is not set');
    return createDynamoStore(table);
}

/** Resolved on first use (inside a request), so a missing table name answers 500 instead of failing at import. */
export const store: AffiliateStore = new Proxy({} as AffiliateStore, {
    get: (_t, prop: keyof AffiliateStore) => {
        current ??= pick();
        return current[prop];
    },
});

export { MOCK_JORDAN, MOCK_PLOY, MOCK_TODAY } from './seed';
export type { Affiliate, AffLink, PayoutMethod, Referral } from './seed';
