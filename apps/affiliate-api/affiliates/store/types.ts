import type { Affiliate, AffLink, PayoutMethod, Referral } from './seed';

/** What the services need from storage. Two implementations: memory-store.ts (tests) and dynamo-store.ts (deployed). */
export interface AffiliateStore {
    getAffiliate(userId: string): Promise<Affiliate | null>;
    /** first write of an affiliate (the application); throws AlreadyAppliedError when one exists */
    createAffiliate(a: Affiliate): Promise<Affiliate>;
    /** profile changes of an existing affiliate */
    putAffiliate(a: Affiliate): Promise<Affiliate>;
    listLinks(userId: string): Promise<AffLink[]>;
    /** adds a link and reserves its address across all affiliates; throws SlugTakenError when the address is used */
    addLink(link: Omit<AffLink, 'id'>): Promise<AffLink>;
    listReferrals(userId: string): Promise<Referral[]>;
    getPayoutMethod(userId: string): Promise<PayoutMethod>;
    putPayoutMethod(userId: string, m: PayoutMethod): Promise<PayoutMethod>;
}
