import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { IService, Service } from '@devyethiha/samjs';
import { findAffiliate } from '../shared/affiliate';
import { AlreadyAppliedError, NotAnAffiliateError } from '../shared/errors';
import type { Affiliate } from '../shared/seed';
import type { Market } from '../shared/rules';
import { createProfile, updateProfile } from './affiliate.repository';
import type { ApplicationInput, ProfileInput } from './dtos';

/** The affiliate account: the application (market fixed from then on) and the profile. */
export class AffiliateService extends Service implements IService {
    constructor(DB_Client: DynamoDBClient, db: DynamoDBDocumentClient) {
        super('affiliate');
        void DB_Client;
        void db;
    }

    /** The signed-in affiliate; the two sample affiliates are written on first use (this Lambda only). */
    async get(userId: string): Promise<Affiliate> {
        const a = await findAffiliate(userId, { seedSamples: true });
        if (!a) throw new NotAnAffiliateError();
        const { reviewedBy, ...own } = a; // who reviewed stays with the team
        void reviewedBy;
        return own;
    }

    /** One application per user, one market per affiliate: a second application is refused, never a market change. */
    async apply(userId: string, email: string, input: ApplicationInput): Promise<Affiliate> {
        if (await findAffiliate(userId, { seedSamples: true })) throw new AlreadyAppliedError();
        return createProfile({
            userId,
            market: input.market as Market,
            stage: 'pending', // the team reviews every application (reviews Lambda, team portal)
            first: input.first,
            last: input.last,
            email,
            phone: input.phone,
            reach: input.reach,
            channelUrl: input.channelUrl,
            plan: input.plan,
            appliedOn: new Date().toISOString().slice(0, 10), // the real date (MOCK_TODAY is only for the sample data)
        });
    }

    /** Name and phone only: the email is the sign-in identity and the market is fixed. */
    async updateProfile(userId: string, input: ProfileInput): Promise<Affiliate> {
        const a = await findAffiliate(userId, { seedSamples: true }); // the full record, so the review fields are kept
        if (!a) throw new NotAnAffiliateError();
        await updateProfile({ ...a, first: input.first, last: input.last, phone: input.phone });
        return this.get(userId);
    }
}
