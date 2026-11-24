import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { IService, Service, ValidationError } from '@devyethiha/samjs';
import { store, type PayoutMethod } from '../store';
import { CURRENCY, MIN_PAYOUT_USD, PAYOUT_PERIOD, RATES, toUsd } from '../domain/rules';
import type { PayoutMethodInput } from '../dtos/schemas';
import { NotAnAffiliateError } from './errors';
import { referralCommission } from './referral.service';

/** Earnings per subscription, the balance against the US$ 100 minimum, and how the affiliate is paid. */
export class PayoutService extends Service implements IService {
    constructor(DB_Client: DynamoDBClient, db: DynamoDBDocumentClient) {
        super('payout');
        void DB_Client;
        void db;
    }

    async summary(userId: string) {
        const affiliate = await store.getAffiliate(userId);
        if (!affiliate) throw new NotAnAffiliateError();
        const [refs, links] = await Promise.all([store.listReferrals(userId), store.listLinks(userId)]);
        const rows = refs
            .filter((r) => r.status === 'subscribed')
            .sort((a, b) => (b.subscribedOn ?? '').localeCompare(a.subscribedOn ?? ''))
            .map((r) => ({
                referralId: r.id,
                business: r.business,
                channel: links.find((l) => l.id === r.linkId)?.channel ?? null,
                subscribedOn: r.subscribedOn ?? null,
                plan: r.plan ?? null,
                rate: r.plan ? RATES[r.plan] : null,
                commission: referralCommission(r),
            }));
        const earned = Math.round(rows.reduce((s, r) => s + r.commission, 0) * 100) / 100;
        const paid = 0; // no payout has been made yet in the mock
        const unpaid = Math.round((earned - paid) * 100) / 100;
        const unpaidUsd = toUsd(affiliate.market, unpaid); // approximate: our own rate service is not built yet
        return {
            currency: CURRENCY[affiliate.market],
            earned,
            paid,
            unpaid,
            unpaidUsdApprox: unpaidUsd,
            minimumUsd: MIN_PAYOUT_USD,
            reachesMinimum: unpaidUsd >= MIN_PAYOUT_USD,
            period: PAYOUT_PERIOD,
            method: await store.getPayoutMethod(userId),
            rows,
        };
    }

    async getMethod(userId: string): Promise<PayoutMethod> {
        if (!(await store.getAffiliate(userId))) throw new NotAnAffiliateError();
        return store.getPayoutMethod(userId);
    }

    /** Stripe, or a bank transfer from the company account. The full account number is never kept or returned by the mock. */
    async setMethod(userId: string, input: PayoutMethodInput): Promise<PayoutMethod> {
        const affiliate = await store.getAffiliate(userId);
        if (!affiliate) throw new NotAnAffiliateError();
        if (input.kind === 'stripe') return store.putPayoutMethod(userId, { kind: 'stripe' });
        // an Australian bank account is found by its BSB (6 digits); Thai accounts have no branch code here
        if (affiliate.market === 'australia' && !/^\d{3}-?\d{3}$/.test(input.branch)) {
            throw new ValidationError('A BSB has 6 digits', [{ path: ['branch'], message: 'A BSB has 6 digits' } as never]);
        }
        const digits = input.accountNumber.replace(/\D/g, '');
        return store.putPayoutMethod(userId, {
            kind: 'bank',
            accountName: input.accountName,
            bank: input.bank,
            branch: affiliate.market === 'australia' ? input.branch : '',
            last4: digits.slice(-4),
        });
    }
}
