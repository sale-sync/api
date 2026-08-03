import { ConditionalCheckFailedException, DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { BatchGetCommand, BatchWriteCommand, DeleteCommand, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { Service } from '@devyethiha/samjs';
import type { BusinessCategory, Image, Market, Organisation, OrganisationRole, OrganisationUser, Subscription } from '@sale-sync/shared/src/types';
import { v4 as uuidv4 } from 'uuid';
import {
    PromoCodeService,
    InvalidPromoCodeError,
    assertPromoCodeRedeemable,
    applyPromoToSubscription,
    buildPromoRedemptionTransactItems,
} from './promo-code.service';

const TABLE = process.env.ORGANISATION_TABLE_NAME || 'sale-sync-organisation';
const INIT_WEBSITE_FUNCTION_NAME = process.env.INIT_WEBSITE_FUNCTION_NAME;
const lambdaClient = new LambdaClient({});

// Every organisation starts with a 14-day trial (backlogs/payments/children/trial-lifecycle) —
// no in-app Stripe checkout yet, so this is purely a DynamoDB-tracked window. Lapse detection and
// soft-block enforcement are separate, not-yet-built pieces of that same backlog.
const TRIAL_DAYS = 14;

type CreateOrganisationParam = {
    user_id: string;
    user_email: string;
    organisation_id: string;
    organisation_name: string;
    business_category: BusinessCategory;
    template_id: string;
    plan_id: string;
    description?: string;
    address?: string;
    market?: Market;
    promo_code?: string;
};

type UpdateOrganisationParam = {
    name?: string;
    description?: string;
    address?: string | null;
    image?: Image | null;
    market?: Market;
};

export class OrganisationAlreadyExistsError extends Error {
    constructor(organisationId: string) {
        super(`Organisation '${organisationId}' already exists`);
        this.name = 'OrganisationAlreadyExistsError';
    }
}

export class LastOwnerError extends Error {
    constructor() {
        super('Cannot remove the last remaining owner of the organisation');
        this.name = 'LastOwnerError';
    }
}

export class InsufficientRoleError extends Error {
    constructor() {
        super('Only owner or admin can manage the team');
        this.name = 'InsufficientRoleError';
    }
}

export class OwnerOnlyActionError extends Error {
    constructor() {
        super('Only an owner can remove or change the role of another owner');
        this.name = 'OwnerOnlyActionError';
    }
}

export class ProfileNotFoundError extends Error {
    constructor() {
        super('No membership record found for this organisation/user');
        this.name = 'ProfileNotFoundError';
    }
}

export class OrganisationService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('organisation');
        this.DB_Client = DB_Client;
    }

    public async createOrganisation(param: CreateOrganisationParam): Promise<void> {
        // Only real-estate has a sync-templates/ content-source template today — the other 4
        // business categories skip website provisioning entirely and land straight on 'ready'
        // (see backlogs/sync-templates). Easy to extend as more categories get their own
        // sync-templates/<category>/ folder.
        const isWebsiteProvisioned = param.business_category === 'real-estate';

        const org: Organisation = {
            uuid: uuidv4(),
            id: param.organisation_id,
            name: param.organisation_name,
            status: isWebsiteProvisioned ? 'creating-website' : 'ready',
            image: null,
            business_category: param.business_category,
            template_id: param.template_id,
            plan_id: param.plan_id,
            created_at: new Date().toISOString(),
            address: param.address ?? null,
            market: param.market ?? 'AU',
            ...(param.description && { description: param.description }),
        };

        const membership: OrganisationUser = {
            role: 'owner',
            joined_date: org.created_at,
        };

        const trialEnd = new Date(new Date(org.created_at).getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
        let subscription: Subscription = {
            uuid: uuidv4(),
            organisation_id: org.uuid,
            plan_id: param.plan_id,
            trial_start: org.created_at,
            trial_end: trialEnd,
            status: 'trialing',
            payment_method: null,
            activated_by: null,
            activated_at: null,
            promo_code: null,
            discount_type: null,
            discount_value: null,
            created_at: org.created_at,
            updated_at: org.created_at,
        };

        // Promo-code redemption (backlogs/payments/children/promo-codes) — self-serve at signup
        // only, folded into this same transaction so an invalid/exhausted code fails org creation
        // atomically rather than leaving a half-created org. The pre-check here gives a friendly
        // error in the common case; the transact items' ConditionExpression below is what actually
        // guards against a race (two orgs redeeming the last slot of a limited code at once).
        let promoTransactItems: ReturnType<typeof buildPromoRedemptionTransactItems> = [];
        if (param.promo_code) {
            const promo = await new PromoCodeService(this.DB_Client).getPromoCodeByCode(param.promo_code);
            if (!promo) {
                throw new InvalidPromoCodeError(`Promo code '${param.promo_code}' was not found`);
            }
            assertPromoCodeRedeemable(promo, new Date(org.created_at));
            subscription = applyPromoToSubscription(promo, subscription);
            promoTransactItems = buildPromoRedemptionTransactItems(promo, org.uuid, org.created_at);
        }

        try {
            await this.DB_Client.send(
                new TransactWriteCommand({
                    TransactItems: [
                        // Organisation metadata — PK=ORG, SK=META#{uuid}
                        {
                            Put: {
                                TableName: TABLE,
                                Item: {
                                    PK: 'ORG',
                                    SK: `META#${org.uuid}`,
                                    data: JSON.stringify(org),
                                },
                                ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
                            },
                        },
                        // Organisation ID uniqueness / slug→uuid lookup — PK=ORG#ID#${id}, SK=META
                        {
                            Put: {
                                TableName: TABLE,
                                Item: {
                                    PK: `ORG#ID#${org.id}`,
                                    SK: 'META',
                                    data: JSON.stringify({ uuid: org.uuid }),
                                },
                                ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
                            },
                        },
                        // Organisation membership — PK=ORG#{uuid}, SK=USER#{user_id}
                        {
                            Put: {
                                TableName: TABLE,
                                Item: {
                                    PK: `ORG#${org.uuid}`,
                                    SK: `USER#${param.user_id}`,
                                    data: JSON.stringify(membership),
                                },
                            },
                        },
                        // User email lookup — PK=USER#{email}, SK=META
                        {
                            Put: {
                                TableName: TABLE,
                                Item: {
                                    PK: `USER#${param.user_email}`,
                                    SK: 'META',
                                    data: JSON.stringify({ user_id: param.user_id }),
                                },
                            },
                        },
                        // User email↔user_id mapping for inverted-index — PK=USER#{email}, SK=USER#{user_id}
                        {
                            Put: {
                                TableName: TABLE,
                                Item: {
                                    PK: `USER#${param.user_email}`,
                                    SK: `USER#${param.user_id}`,
                                },
                            },
                        },
                        // Subscription/trial record (14-day trial starts now) — PK=ORG#{uuid}, SK=SUBSCRIPTION.
                        // GSI2PK/GSI2SK feed the `trial-status-index` sparse GSI that
                        // infra/functions/check-trial-lapses queries for lapsed trials — every new
                        // subscription starts 'trialing', so both are always set on create. Removed
                        // by whichever write next moves status away from 'trialing' (the lapse-check
                        // function itself, or admin/'s manual reactivation).
                        {
                            Put: {
                                TableName: TABLE,
                                Item: {
                                    PK: `ORG#${org.uuid}`,
                                    SK: 'SUBSCRIPTION',
                                    GSI2PK: 'SUBSCRIPTION#TRIALING',
                                    GSI2SK: subscription.trial_end,
                                    data: JSON.stringify(subscription),
                                },
                            },
                        },
                        // Promo-code redemption (indices 6-7, only present if param.promo_code was
                        // given) — see the catch block below, which distinguishes these from the
                        // org-uniqueness items above by index.
                        ...promoTransactItems,
                    ],
                }),
            );
        } catch (error: unknown) {
            if (error instanceof TransactionCanceledException) {
                const reasons = error.CancellationReasons ?? [];
                if (reasons[0]?.Code === 'ConditionalCheckFailed' || reasons[1]?.Code === 'ConditionalCheckFailed') {
                    throw new OrganisationAlreadyExistsError(param.organisation_id);
                }
                if (reasons[6]?.Code === 'ConditionalCheckFailed' || reasons[7]?.Code === 'ConditionalCheckFailed') {
                    throw new InvalidPromoCodeError('Promo code is no longer valid or has already reached its redemption limit');
                }
            }
            throw error;
        }

        // Fire-and-forget: kick off website provisioning (infra/functions/init-website, see
        // backlogs/sync-templates) without blocking the response — the org row above is already
        // committed, so a failed invoke here must never fail org creation. init-website only
        // creates the CFN stack and returns; infra/functions/website-stack-complete reacts to the
        // stack's completion event later and flips status to 'ready'/'website-failed'.
        if (isWebsiteProvisioned && INIT_WEBSITE_FUNCTION_NAME) {
            try {
                await lambdaClient.send(
                    new InvokeCommand({
                        FunctionName: INIT_WEBSITE_FUNCTION_NAME,
                        InvocationType: 'Event',
                        Payload: JSON.stringify({ organisation_id: org.id }),
                    }),
                );
            } catch (error) {
                console.error('Failed to invoke init-website — org created, but website provisioning was not started', error);
            }
        }
    }

    // List all organisations a user belongs to (inverted-index, SK=USER#{userId})
    public async getOrganisationsByUserId(userId: string): Promise<Organisation[]> {
        const res = await this.DB_Client.send(
            new QueryCommand({
                TableName: TABLE,
                IndexName: 'inverted-index',
                KeyConditionExpression: 'SK = :sk AND begins_with(PK, :prefix)',
                ExpressionAttributeValues: {
                    ':sk': `USER#${userId}`,
                    ':prefix': 'ORG#',
                },
            }),
        );

        const orgUuids = res.Items?.map((it: Record<string, unknown>) => String(it.PK).replace('ORG#', '')) ?? [];
        if (orgUuids.length === 0) return [];

        const batch = await this.DB_Client.send(
            new BatchGetCommand({
                RequestItems: {
                    [TABLE]: {
                        Keys: orgUuids.map((uuid) => ({ PK: 'ORG', SK: `META#${uuid}` })),
                    },
                },
            }),
        );

        return (batch.Responses?.[TABLE] ?? []).map((item: Record<string, unknown>) => JSON.parse(item.data as string) as Organisation);
    }

    // Lookup organisation by human-readable id (slug) — PK=ORG#ID#${id}, SK=META
    public async getOrganisationById(orgId: string): Promise<Organisation | null> {
        const lookup = await this.DB_Client.send(
            new GetCommand({
                TableName: TABLE,
                Key: { PK: `ORG#ID#${orgId}`, SK: 'META' },
            }),
        );

        if (!lookup.Item) return null;

        const { uuid } = JSON.parse(lookup.Item.data as string) as { uuid: string };
        const meta = await this.DB_Client.send(
            new GetCommand({
                TableName: TABLE,
                Key: { PK: 'ORG', SK: `META#${uuid}` },
            }),
        );

        return meta.Item ? (JSON.parse(meta.Item.data) as Organisation) : null;
    }

    // Update organisation profile (name/description/address) — PK=ORG, SK=META#{uuid}. Restricted to
    // owner/admin, same bar as team management, since the profile is org-wide-visible. Existence of
    // the org is implied by the caller having a resolvable membership (checked by assertCanManageTeam).
    public async updateOrganisation(
        orgUuid: string,
        patch: UpdateOrganisationParam,
        callerUserId: string,
    ): Promise<Organisation> {
        await this.assertCanManageTeam(orgUuid, callerUserId);

        const res = await this.DB_Client.send(
            new GetCommand({
                TableName: TABLE,
                Key: { PK: 'ORG', SK: `META#${orgUuid}` },
            }),
        );

        const current = JSON.parse(res.Item!.data as string) as Organisation;
        const updated: Organisation = {
            ...current,
            ...(patch.name !== undefined && { name: patch.name }),
            ...(patch.description !== undefined && { description: patch.description }),
            ...(patch.address !== undefined && { address: patch.address }),
            ...(patch.image !== undefined && { image: patch.image }),
            ...(patch.market !== undefined && { market: patch.market }),
        };

        await this.DB_Client.send(
            new PutCommand({
                TableName: TABLE,
                Item: { PK: 'ORG', SK: `META#${orgUuid}`, data: JSON.stringify(updated) },
            }),
        );

        return updated;
    }

    // List all users in an organisation — PK=ORG#{uuid}, SK begins_with USER#
    public async getUsersByOrganisationUuid(
        orgUuid: string,
    ): Promise<Array<{ user_id: string; membership: OrganisationUser }>> {
        const res = await this.DB_Client.send(
            new QueryCommand({
                TableName: TABLE,
                KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
                ExpressionAttributeValues: {
                    ':pk': `ORG#${orgUuid}`,
                    ':prefix': 'USER#',
                },
            }),
        );

        return (res.Items ?? []).map((item: Record<string, unknown>) => ({
            user_id: String(item.SK).replace('USER#', ''),
            membership: JSON.parse(item.data as string) as OrganisationUser,
        }));
    }

    // Lookup a single member's own membership — PK=ORG#{orgUuid}, SK=USER#{userId}
    public async getMembership(orgUuid: string, userId: string): Promise<OrganisationUser | null> {
        const res = await this.DB_Client.send(
            new GetCommand({
                TableName: TABLE,
                Key: { PK: `ORG#${orgUuid}`, SK: `USER#${userId}` },
            }),
        );

        return res.Item ? (JSON.parse(res.Item.data as string) as OrganisationUser) : null;
    }

    // Get the caller's own profile fields (phone/bio/timezone/avatar) from their membership record —
    // PK=ORG#{orgUuid}, SK=USER#{userId}. Same record as getMembership; name/email are merged in by the
    // controller from the Cognito-derived `user` on the event, not stored here.
    public async getProfile(orgUuid: string, userId: string): Promise<OrganisationUser | null> {
        return this.getMembership(orgUuid, userId);
    }

    // Update the caller's own profile fields (phone/bio/timezone/avatar) — PK=ORG#{orgUuid},
    // SK=USER#{userId}. Unlike updateTeamMemberRole, this only ever touches the caller's own record, so
    // no assertCanManageTeam/role check is needed — every member manages their own profile.
    public async updateProfile(
        orgUuid: string,
        userId: string,
        patch: { phone?: string; bio?: string; timezone?: string; avatar?: Image | null },
    ): Promise<OrganisationUser> {
        const current = await this.getMembership(orgUuid, userId);
        if (!current) {
            throw new ProfileNotFoundError();
        }

        const updated: OrganisationUser = {
            ...current,
            ...(patch.phone !== undefined && { phone: patch.phone }),
            ...(patch.bio !== undefined && { bio: patch.bio }),
            ...(patch.timezone !== undefined && { timezone: patch.timezone }),
            ...(patch.avatar !== undefined && { avatar: patch.avatar }),
        };

        await this.DB_Client.send(
            new UpdateCommand({
                TableName: TABLE,
                Key: { PK: `ORG#${orgUuid}`, SK: `USER#${userId}` },
                UpdateExpression: 'SET #data = :data',
                ExpressionAttributeNames: { '#data': 'data' },
                ExpressionAttributeValues: { ':data': JSON.stringify(updated) },
            }),
        );

        return updated;
    }

    // Only `owner`/`admin` may manage team membership (add/remove/change-role) — `manager` and below
    // cannot. Returns the caller's own resolved role so call sites needing the owner-only check don't
    // have to re-fetch it.
    public async assertCanManageTeam(orgUuid: string, callerUserId: string): Promise<OrganisationRole> {
        const membership = await this.getMembership(orgUuid, callerUserId);
        if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
            throw new InsufficientRoleError();
        }
        return membership.role;
    }

    // Lookup user by email — PK=USER#{email}, SK=META
    public async getUserByEmail(email: string): Promise<{ user_id: string } | null> {
        const res = await this.DB_Client.send(
            new GetCommand({
                TableName: TABLE,
                Key: { PK: `USER#${email}`, SK: 'META' },
            }),
        );

        return res.Item ? (JSON.parse(res.Item.data as string) as { user_id: string }) : null;
    }

    // Lookup user by user_id via inverted-index — SK=USER#{userId}, PK begins_with USER#
    public async getUserById(userId: string): Promise<{ email: string } | null> {
        const res = await this.DB_Client.send(
            new QueryCommand({
                TableName: TABLE,
                IndexName: 'inverted-index',
                KeyConditionExpression: 'SK = :sk AND begins_with(PK, :prefix)',
                ExpressionAttributeValues: {
                    ':sk': `USER#${userId}`,
                    ':prefix': 'USER#',
                },
            }),
        );

        const item = res.Items?.[0] as Record<string, unknown> | undefined;
        return item ? { email: String(item.PK).replace('USER#', '') } : null;
    }

    // Add team members by email — PK=USER#{email}, SK=META to resolve user_id.
    // Registered users → PK=ORG#{orgUuid}, SK=USER#{user_id}, data=OrganisationUser, added immediately.
    // Unregistered emails are not written anywhere — reported back in `not_found` so the caller can
    // ask them to register first (no pending-invite state at this stage).
    public async addTeamMembers(
        orgUuid: string,
        emails: string[],
        callerUserId: string,
    ): Promise<{ added: string[]; not_found: string[] }> {
        await this.assertCanManageTeam(orgUuid, callerUserId);

        const batchGet = await this.DB_Client.send(
            new BatchGetCommand({
                RequestItems: {
                    [TABLE]: {
                        Keys: emails.map((email) => ({ PK: `USER#${email}`, SK: 'META' })),
                    },
                },
            }),
        );

        const registeredMap = new Map<string, string>();
        for (const item of (batchGet.Responses?.[TABLE] ?? []) as Record<string, unknown>[]) {
            const email = String(item.PK).replace('USER#', '');
            const { user_id } = JSON.parse(item.data as string) as { user_id: string };
            registeredMap.set(email, user_id);
        }

        const now = new Date().toISOString();
        const registeredEmails = emails.filter((e) => registeredMap.has(e));

        if (registeredEmails.length > 0) {
            const writeRequests = registeredEmails.map((email) => {
                const userId = registeredMap.get(email)!;
                const membership: OrganisationUser = { role: 'staff', joined_date: now };
                return {
                    PutRequest: {
                        Item: { PK: `ORG#${orgUuid}`, SK: `USER#${userId}`, data: JSON.stringify(membership) },
                    },
                };
            });

            await this.DB_Client.send(
                new BatchWriteCommand({ RequestItems: { [TABLE]: writeRequests } }),
            );
        }

        return {
            added: registeredEmails,
            not_found: emails.filter((e) => !registeredMap.has(e)),
        };
    }

    // Add team members by user_id — for users who already have a Cognito account (resolved via a
    // prior GET /organisations/users?email= lookup, for example) but aren't yet a member of this org.
    // Existence is checked via the inverted-index (SK=USER#{userId}), same as getUserById.
    // PK=ORG#{orgUuid}, SK=USER#{userId}, data=OrganisationUser
    public async addTeamMembersByUserId(
        orgUuid: string,
        userIds: string[],
        callerUserId: string,
    ): Promise<{ added: string[]; not_found: string[] }> {
        await this.assertCanManageTeam(orgUuid, callerUserId);

        const lookups = await Promise.all(
            userIds.map((userId) =>
                this.DB_Client.send(
                    new QueryCommand({
                        TableName: TABLE,
                        IndexName: 'inverted-index',
                        KeyConditionExpression: 'SK = :sk AND begins_with(PK, :prefix)',
                        ExpressionAttributeValues: { ':sk': `USER#${userId}`, ':prefix': 'USER#' },
                        Limit: 1,
                    }),
                ),
            ),
        );

        const found = new Set(userIds.filter((_, i) => (lookups[i].Items?.length ?? 0) > 0));
        const added = userIds.filter((id) => found.has(id));
        const notFound = userIds.filter((id) => !found.has(id));

        if (added.length > 0) {
            const now = new Date().toISOString();
            const writeRequests = added.map((userId) => {
                const membership: OrganisationUser = { role: 'staff', joined_date: now };
                return {
                    PutRequest: {
                        Item: { PK: `ORG#${orgUuid}`, SK: `USER#${userId}`, data: JSON.stringify(membership) },
                    },
                };
            });

            await this.DB_Client.send(new BatchWriteCommand({ RequestItems: { [TABLE]: writeRequests } }));
        }

        return { added, not_found: notFound };
    }

    // Remove a team member — PK=ORG#{orgUuid}, SK=USER#{userId}. Rejects removing the org's sole
    // remaining owner (an org must always have at least one).
    public async removeTeamMember(orgUuid: string, userId: string, callerUserId: string): Promise<void> {
        const callerRole = await this.assertCanManageTeam(orgUuid, callerUserId);

        const members = await this.getUsersByOrganisationUuid(orgUuid);
        const target = members.find((m) => m.user_id === userId);

        if (target?.membership.role === 'owner' && callerRole !== 'owner') {
            throw new OwnerOnlyActionError();
        }

        if (target?.membership.role === 'owner') {
            const ownerCount = members.filter((m) => m.membership.role === 'owner').length;
            if (ownerCount <= 1) {
                throw new LastOwnerError();
            }
        }

        await this.DB_Client.send(
            new DeleteCommand({
                TableName: TABLE,
                Key: { PK: `ORG#${orgUuid}`, SK: `USER#${userId}` },
            }),
        );
    }

    // Update a team member's role — PK=ORG#{orgUuid}, SK=USER#{userId}. Rejects demoting the org's
    // sole remaining owner away from `owner` (an org must always have at least one).
    public async updateTeamMemberRole(
        orgUuid: string,
        userId: string,
        role: OrganisationRole,
        callerUserId: string,
    ): Promise<void> {
        const callerRole = await this.assertCanManageTeam(orgUuid, callerUserId);

        const members = await this.getUsersByOrganisationUuid(orgUuid);
        const target = members.find((m) => m.user_id === userId);

        if (target?.membership.role === 'owner' && callerRole !== 'owner') {
            throw new OwnerOnlyActionError();
        }

        if (target?.membership.role === 'owner' && role !== 'owner') {
            const ownerCount = members.filter((m) => m.membership.role === 'owner').length;
            if (ownerCount <= 1) {
                throw new LastOwnerError();
            }
        }

        const updated: OrganisationUser = { ...target!.membership, role };

        await this.DB_Client.send(
            new UpdateCommand({
                TableName: TABLE,
                Key: { PK: `ORG#${orgUuid}`, SK: `USER#${userId}` },
                UpdateExpression: 'SET #data = :data',
                ExpressionAttributeNames: { '#data': 'data' },
                ExpressionAttributeValues: { ':data': JSON.stringify(updated) },
            }),
        );
    }
}
