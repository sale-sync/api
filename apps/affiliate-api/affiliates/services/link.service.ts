import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { IService, Service } from '@devyethiha/samjs';
import { store, MOCK_TODAY } from '../store/mock-store';
import { LINK_BASE, type Channel } from '../domain/rules';
import type { LinkInput } from '../dtos/schemas';
import { NotAnAffiliateError, NotApprovedError, SlugTakenError } from './errors';
import { referralCommission } from './referral.service';

/** An affiliate's links, one per channel, each with its own results. */
export class LinkService extends Service implements IService {
    constructor(DB_Client: DynamoDBClient, db: DynamoDBDocumentClient) {
        super('link');
        void DB_Client;
        void db;
    }

    async list(userId: string) {
        const affiliate = await store.getAffiliate(userId);
        if (!affiliate) throw new NotAnAffiliateError();
        const [links, refs] = await Promise.all([store.listLinks(userId), store.listReferrals(userId)]);
        return links.map((l) => {
            const mine = refs.filter((r) => r.linkId === l.id);
            return {
                ...l,
                url: LINK_BASE + l.slug,
                stats: {
                    clicks: l.clicks,
                    signups: mine.length,
                    subscribed: mine.filter((r) => r.status === 'subscribed').length,
                    earned: Math.round(mine.reduce((s, r) => s + referralCommission(r), 0) * 100) / 100,
                },
            };
        });
    }

    async create(userId: string, input: LinkInput) {
        const affiliate = await store.getAffiliate(userId);
        if (!affiliate) throw new NotAnAffiliateError();
        if (affiliate.stage !== 'approved') throw new NotApprovedError();
        if (await store.slugTaken(input.slug)) throw new SlugTakenError(input.slug);
        const channel = input.channel as Channel;
        const link = await store.addLink({ userId, channel, name: input.name || channel, slug: input.slug, clicks: 0, createdOn: MOCK_TODAY.toISOString().slice(0, 10) });
        return { ...link, url: LINK_BASE + link.slug, stats: { clicks: 0, signups: 0, subscribed: 0, earned: 0 } };
    }
}
