// Referrals domain: the referral records (PK AFF#<userId>, SK REF#<id>), read only here (referrals are written when a business
// signs up through a link: click tracking and crediting, not built yet). The link of each referral is read from the links
// domain's records, read-only, for its channel and name.
import { queryAffiliate } from '../shared/db';
import type { AffLink, Referral } from '../shared/seed';

export const listReferrals = (userId: string) => queryAffiliate<Referral>(userId, 'REF#');
/** read-only, for the channel and name of each referral's link */
export const listLinksForNames = (userId: string) => queryAffiliate<AffLink>(userId, 'LINK#');
