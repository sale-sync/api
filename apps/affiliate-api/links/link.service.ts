import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { IService, Service } from '@devyethiha/samjs';
import { requireAffiliate, requireApproved } from '../shared/affiliate';
import { LINK_BASE, referralCommission, type Channel } from '../shared/rules';
import { addLink, listLinks, listReferralsForStats } from './link.repository';
import type { LinkInput } from './dtos';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** An affiliate's links, one per channel, each with its own results. */
export class LinkService extends Service implements IService {
    constructor(DB_Client: DynamoDBClient, db: DynamoDBDocumentClient) {
        super('link');
        void DB_Client;
        void db;
    }

    async list(userId: string) {
        await requireAffiliate(userId);
        const [links, refs] = await Promise.all([listLinks(userId), listReferralsForStats(userId)]);
        return links.map((l) => {
            const mine = refs.filter((r) => r.linkId === l.id);
            return {
                ...l,
                url: LINK_BASE + l.slug,
                stats: {
                    clicks: l.clicks,
                    signups: mine.length,
                    subscribed: mine.filter((r) => r.status === 'subscribed').length,
                    earned: round2(mine.reduce((s, r) => s + referralCommission(r), 0)),
                },
            };
        });
    }

    /** Only approved affiliates make links; the address must be free across every affiliate. */
    async create(userId: string, input: LinkInput) {
        await requireApproved(userId);
        const channel = input.channel as Channel;
        const link = await addLink({ userId, channel, name: input.name || channel, slug: input.slug, clicks: 0, createdOn: new Date().toISOString().slice(0, 10) });
        return { ...link, url: LINK_BASE + link.slug, stats: { clicks: 0, signups: 0, subscribed: 0, earned: 0 } };
    }
}
