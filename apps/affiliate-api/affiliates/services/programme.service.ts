import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { IService, Service } from '@devyethiha/samjs';
import { CHANNELS, CURRENCY, MARKETS, MIN_PAYOUT_USD, PAYOUT_PERIOD, PLANS, RATES, TRIAL_DAYS } from '../domain/rules';

/** The public programme terms (the landing pages and the dashboard read them; nothing private). */
export class ProgrammeService extends Service implements IService {
    constructor(DB_Client: DynamoDBClient, db: DynamoDBDocumentClient) {
        super('programme');
        void DB_Client;
        void db;
    }

    terms() {
        return {
            markets: MARKETS.map((m) => ({ market: m, currency: CURRENCY[m], main: m === 'australia' })),
            plans: PLANS.map((months) => ({ months, rate: RATES[months] })),
            trialDays: TRIAL_DAYS,
            renewalsEarn: false,
            payout: { period: PAYOUT_PERIOD, minimumUsd: MIN_PAYOUT_USD, methods: ['stripe', 'bank'] },
            channels: CHANNELS,
        };
    }
}
