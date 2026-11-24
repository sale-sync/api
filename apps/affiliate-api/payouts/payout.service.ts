import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { IService, Service, ValidationError } from '@devyethiha/samjs';
import { requireAffiliate } from '../shared/affiliate';
import { CURRENCY, MIN_PAYOUT_USD, PAYOUT_PERIOD, RATES, referralCommission, toUsd } from '../shared/rules';
import type { PayoutMethod } from '../shared/seed';
import { getMethod, listLinksForChannels, listReferralsForEarnings, putMethod } from './payout.repository';
import type { PayoutMethodInput } from './dtos';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Earnings per subscription, the balance against the US$ 100 minimum, and how the affiliate is paid. */
export class PayoutService extends Service implements IService {
    constructor(DB_Client: DynamoDBClient, db: DynamoDBDocumentClient) {
        super('payout');
        void DB_Client;
        void db;
    }

    async summary(userId: string) {
        const affiliate = await requireAffiliate(userId);
        const [refs, links, method] = await Promise.all([listReferralsForEarnings(userId), listLinksForChannels(userId), getMethod(userId)]);
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
        const earned = round2(rows.reduce((s, r) => s + r.commission, 0));
        const paid = 0; // no payout has been made yet
        const unpaid = round2(earned - paid);
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
            method,
            rows,
        };
    }

    async getMethod(userId: string): Promise<PayoutMethod> {
        await requireAffiliate(userId);
        return getMethod(userId);
    }

    /** Stripe, or a bank transfer from the company account. The full account number is never kept or returned. */
    async setMethod(userId: string, input: PayoutMethodInput): Promise<PayoutMethod> {
        const affiliate = await requireAffiliate(userId);
        if (input.kind === 'stripe') return putMethod(userId, { kind: 'stripe' });
        // an Australian bank account is found by its BSB (6 digits); Thai accounts have no branch code here
        if (affiliate.market === 'australia' && !/^\d{3}-?\d{3}$/.test(input.branch)) {
            throw new ValidationError('A BSB has 6 digits', [{ path: ['branch'], message: 'A BSB has 6 digits' } as never]);
        }
        const digits = input.accountNumber.replace(/\D/g, '');
        return putMethod(userId, { kind: 'bank', accountName: input.accountName, bank: input.bank, branch: affiliate.market === 'australia' ? input.branch : '', last4: digits.slice(-4) });
    }
}
