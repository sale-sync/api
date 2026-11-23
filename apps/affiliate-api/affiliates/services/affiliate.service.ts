import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { IService, Service } from '@devyethiha/samjs';
import { store, MOCK_TODAY, type Affiliate } from '../store/mock-store';
import type { Market } from '../domain/rules';
import type { ApplicationInput, ProfileInput } from '../dtos/schemas';
import { AlreadyAppliedError, NotAnAffiliateError } from './errors';

/** The affiliate account: the application (market fixed from then on) and the profile. Mock store, no DynamoDB yet. */
export class AffiliateService extends Service implements IService {
    constructor(DB_Client: DynamoDBClient, db: DynamoDBDocumentClient) {
        super('affiliate');
        void DB_Client;
        void db;
    }

    async get(userId: string): Promise<Affiliate> {
        const a = await store.getAffiliate(userId);
        if (!a) throw new NotAnAffiliateError();
        return a;
    }

    /** One application per user, one market per affiliate: a second application is refused, never a market change. */
    async apply(userId: string, email: string, input: ApplicationInput): Promise<Affiliate> {
        if (await store.getAffiliate(userId)) throw new AlreadyAppliedError();
        return store.putAffiliate({
            userId,
            market: input.market as Market,
            stage: 'pending', // the team reviews every application (review flow not built yet)
            first: input.first,
            last: input.last,
            email,
            phone: input.phone,
            reach: input.reach,
            channelUrl: input.channelUrl,
            plan: input.plan,
            appliedOn: MOCK_TODAY.toISOString().slice(0, 10),
        });
    }

    /** Name and phone only: the email is the sign-in identity and the market is fixed. */
    async updateProfile(userId: string, input: ProfileInput): Promise<Affiliate> {
        const a = await this.get(userId);
        return store.putAffiliate({ ...a, first: input.first, last: input.last, phone: input.phone });
    }
}
