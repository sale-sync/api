import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { IService, Service } from '@devyethiha/samjs';
import { requireAffiliate } from '../shared/affiliate';
import { RATES, referralCommission, trialDaysLeft, type ReferralStatus } from '../shared/rules';
import { MOCK_TODAY } from '../shared/seed';
import { listLinksForNames, listReferrals } from './referral.repository';

/** The businesses that signed up through an affiliate's links. Only the business name is shared with the affiliate. */
export class ReferralService extends Service implements IService {
    constructor(DB_Client: DynamoDBClient, db: DynamoDBDocumentClient) {
        super('referral');
        void DB_Client;
        void db;
    }

    async list(userId: string, status?: ReferralStatus) {
        await requireAffiliate(userId);
        const [refs, links] = await Promise.all([listReferrals(userId), listLinksForNames(userId)]);
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
