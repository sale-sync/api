import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { IService, Service } from '@devyethiha/samjs';
import { store, MOCK_TODAY, type Referral } from '../store';
import { RATES, commission, trialDaysLeft, type ReferralStatus } from '../domain/rules';
import { NotAnAffiliateError } from './errors';

/** Commission of one referral: only once it is subscribed, at its plan's rate on its commission base. Renewals never add more. */
export const referralCommission = (r: Referral) => (r.status === 'subscribed' && r.plan && r.commissionBase ? commission(r.plan, r.commissionBase) : 0);

/** The businesses that signed up through an affiliate's links. Only the business name is shared with the affiliate. */
export class ReferralService extends Service implements IService {
    constructor(DB_Client: DynamoDBClient, db: DynamoDBDocumentClient) {
        super('referral');
        void DB_Client;
        void db;
    }

    async list(userId: string, status?: ReferralStatus) {
        if (!(await store.getAffiliate(userId))) throw new NotAnAffiliateError();
        const [refs, links] = await Promise.all([store.listReferrals(userId), store.listLinks(userId)]);
        return refs
            .filter((r) => !status || r.status === status)
            .sort((a, b) => b.signedUp.localeCompare(a.signedUp))
            .map((r) => {
                const link = links.find((l) => l.id === r.linkId);
                return {
                    id: r.id,
                    business: r.business,
                    link: link ? { id: link.id, channel: link.channel, name: link.name } : null,
                    signedUp: r.signedUp,
                    status: r.status,
                    trialDaysLeft: r.status === 'trial' ? trialDaysLeft(r.signedUp, MOCK_TODAY) : null,
                    plan: r.plan ?? null,
                    rate: r.plan ? RATES[r.plan] : null,
                    subscribedOn: r.subscribedOn ?? null,
                    commission: referralCommission(r),
                };
            });
    }
}
