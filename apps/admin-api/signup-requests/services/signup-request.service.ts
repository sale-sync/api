import { DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { Service } from '@devyethiha/samjs';
import type { Organisation, OrganisationUser, SignupRequest, Subscription } from '@sale-sync/shared/src/types';
import { v4 as uuidv4 } from 'uuid';

// No hardcoded fallback: staging (`staging-sale-sync-organisation`) and prod
// (`sale-sync-organisation`) are different literal tables (see admin.samconfig.toml) — a default
// here would mean a misconfigured staging deploy silently writes to the prod table instead of
// erroring. Read lazily (not hoisted to a module-level const) so a test's env var setup (which
// runs after this module is first imported) is still picked up.
function getTable(): string {
    return process.env.ORGANISATION_TABLE_NAME as string;
}
const INIT_WEBSITE_FUNCTION_NAME = process.env.INIT_WEBSITE_FUNCTION_NAME;
const lambdaClient = new LambdaClient({});

// Mirrors api/apps/api/organisation/services/organisation.service.ts's TRIAL_DAYS — every
// organisation starts with the same 14-day trial regardless of which app created it.
const TRIAL_DAYS = 14;

export class SignupRequestNotFoundError extends Error {
    constructor(uuid: string) {
        super(`Signup request '${uuid}' not found`);
        this.name = 'SignupRequestNotFoundError';
    }
}

export class SignupRequestAlreadyActionedError extends Error {
    constructor(uuid: string, status: string) {
        super(`Signup request '${uuid}' has already been ${status}`);
        this.name = 'SignupRequestAlreadyActionedError';
    }
}

export class OrganisationAlreadyExistsError extends Error {
    constructor(organisationId: string) {
        super(`Organisation '${organisationId}' already exists`);
        this.name = 'OrganisationAlreadyExistsError';
    }
}

export class SignupRequestService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('signup-request');
        this.DB_Client = DB_Client;
    }

    // List signup requests. 'pending' (default) reads the sparse trial-status-index GSI
    // (GSI2PK='SIGNUP#PENDING') — the same GSI check-trial-lapses uses for lapsed trials, repurposed
    // here for the pending-approval queue. Any other status (or 'all') falls back to a direct query
    // on PK=SIGNUP begins_with SK=META# (mirrors organisation's own listOrganisations shape),
    // filtered in memory since status lives inside the JSON-encoded `data` blob, not a top-level
    // attribute a DynamoDB FilterExpression could reach.
    public async listSignupRequests(status: SignupRequest['status'] | 'all' = 'pending'): Promise<SignupRequest[]> {
        if (status === 'pending') {
            const res = await this.DB_Client.send(
                new QueryCommand({
                    TableName: getTable(),
                    IndexName: 'trial-status-index',
                    KeyConditionExpression: 'GSI2PK = :pk',
                    ExpressionAttributeValues: { ':pk': 'SIGNUP#PENDING' },
                }),
            );
            return (res.Items ?? []).map((item) => JSON.parse(item.data as string) as SignupRequest);
        }

        const res = await this.DB_Client.send(
            new QueryCommand({
                TableName: getTable(),
                KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
                ExpressionAttributeValues: { ':pk': 'SIGNUP', ':prefix': 'META#' },
            }),
        );
        const all = (res.Items ?? []).map((item) => JSON.parse(item.data as string) as SignupRequest);
        return status === 'all' ? all : all.filter((request) => request.status === status);
    }

    // Get a single signup request by uuid — PK=SIGNUP, SK=META#{uuid}
    public async getSignupRequestById(uuid: string): Promise<SignupRequest | null> {
        const res = await this.DB_Client.send(
            new GetCommand({
                TableName: getTable(),
                Key: { PK: 'SIGNUP', SK: `META#${uuid}` },
            }),
        );
        return res.Item ? (JSON.parse(res.Item.data as string) as SignupRequest) : null;
    }

    // Approve a request (from 'pending' OR a previously 'rejected' request — an admin can reverse a
    // rejection later, see Known Gaps in the FSD for the "banana"/"apple" edge cases this models):
    // creates the real organisation (near-duplicate of OrganisationService.createOrganisation()'s
    // transaction in api/apps/api, including the real-estate init-website invoke — deliberately
    // duplicated rather than a cross-Lambda invoke, matching this repo's existing admin-api/api
    // isolation convention), then flips the request to 'approved'. On failure (slug taken since
    // request), the request is left as it was and the error propagates — never corrupt its state.
    // The status-flip write is conditioned on `Approved` not yet being set — a permanent, one-way
    // top-level marker (never REMOVE'd, unlike GSI2PK) — so once a request is approved, no later
    // approve OR reject can ever act on it again (an org already exists; rejecting it makes no sense).
    // Before approval, though, any number of approve/reject actions can race or alternate — whichever
    // write lands last simply reflects the current truth, which is the intended behavior, not a bug.
    public async approveSignupRequest(uuid: string, reviewerUserId: string): Promise<Organisation> {
        const request = await this.assertNotApproved(uuid);

        const org = await this.createOrganisationFromApprovedRequest(request);

        const now = new Date().toISOString();
        try {
            await this.DB_Client.send(
                new TransactWriteCommand({
                    TransactItems: [
                        {
                            Update: {
                                TableName: getTable(),
                                Key: { PK: 'SIGNUP', SK: `META#${uuid}` },
                                UpdateExpression: 'SET #data = :data, Approved = :approved REMOVE GSI2PK, GSI2SK',
                                ConditionExpression: 'attribute_not_exists(Approved)',
                                ExpressionAttributeNames: { '#data': 'data' },
                                ExpressionAttributeValues: {
                                    ':approved': true,
                                    ':data': JSON.stringify({
                                        ...request,
                                        status: 'approved',
                                        resulting_organisation_uuid: org.uuid,
                                        reviewed_by_user_id: reviewerUserId,
                                        reviewed_at: now,
                                    } satisfies SignupRequest),
                                },
                            },
                        },
                        // Free the organisation_id slug for a fresh signup attempt — the newly-created org's
                        // own ORG#ID# lock (written inside createOrganisationFromApprovedRequest) now owns
                        // that uniqueness guarantee, so the signup-side dedup lock is no longer needed.
                        {
                            Delete: {
                                TableName: getTable(),
                                Key: { PK: `SIGNUP#ID#${request.organisation_id}`, SK: 'META' },
                            },
                        },
                    ],
                }),
            );
        } catch (error: unknown) {
            if (error instanceof TransactionCanceledException) {
                const reasons = error.CancellationReasons ?? [];
                if (reasons[0]?.Code === 'ConditionalCheckFailed') {
                    // A concurrent approve already won since assertNotApproved() read this request —
                    // the org above was already created (that side effect can't be undone here), but
                    // the signup request itself is not corrupted: it stays 'approved' from whichever
                    // call actually won the write.
                    throw new SignupRequestAlreadyActionedError(uuid, 'approved');
                }
            }
            throw error;
        }

        return org;
    }

    // Reject a request (from 'pending' OR re-reject an already-'rejected' one, which just updates the
    // reason — harmless). Blocked once `Approved` is set: an admin cannot reject a request whose
    // organisation has already been created (the "apple" edge case) — freezing/suspending a live
    // organisation is a separate action on the Organisation itself
    // (AdminUpdateOrganisationSchema/`PATCH /organisations/by-id`, api/apps/admin-api/organisation),
    // not something this endpoint does. No org-table side effects either way, just flips status and
    // frees the dedup lock so the same organisation_id can be resubmitted as a brand-new request too.
    public async rejectSignupRequest(uuid: string, reviewerUserId: string, rejectionReason: string): Promise<void> {
        const request = await this.assertNotApproved(uuid);

        const now = new Date().toISOString();
        try {
            await this.DB_Client.send(
                new TransactWriteCommand({
                    TransactItems: [
                        {
                            Update: {
                                TableName: getTable(),
                                Key: { PK: 'SIGNUP', SK: `META#${uuid}` },
                                UpdateExpression: 'SET #data = :data REMOVE GSI2PK, GSI2SK',
                                // Same one-way guard as approveSignupRequest() — see its comment.
                                ConditionExpression: 'attribute_not_exists(Approved)',
                                ExpressionAttributeNames: { '#data': 'data' },
                                ExpressionAttributeValues: {
                                    ':data': JSON.stringify({
                                        ...request,
                                        status: 'rejected',
                                        rejection_reason: rejectionReason,
                                        reviewed_by_user_id: reviewerUserId,
                                        reviewed_at: now,
                                    } satisfies SignupRequest),
                                },
                            },
                        },
                        {
                            Delete: {
                                TableName: getTable(),
                                Key: { PK: `SIGNUP#ID#${request.organisation_id}`, SK: 'META' },
                            },
                        },
                    ],
                }),
            );
        } catch (error: unknown) {
            if (error instanceof TransactionCanceledException) {
                const reasons = error.CancellationReasons ?? [];
                if (reasons[0]?.Code === 'ConditionalCheckFailed') {
                    // A concurrent approve won since assertNotApproved() read this request — reject
                    // arrived too late, the organisation already exists.
                    throw new SignupRequestAlreadyActionedError(uuid, 'approved');
                }
            }
            throw error;
        }
    }

    // Allows acting on 'pending' or 'rejected' requests (approve can reverse a prior rejection);
    // blocks only once the request has been 'approved' — at that point a live organisation exists and
    // no further action (approve or reject) on this SignupRequest makes sense.
    private async assertNotApproved(uuid: string): Promise<SignupRequest> {
        const request = await this.getSignupRequestById(uuid);
        if (!request) {
            throw new SignupRequestNotFoundError(uuid);
        }
        if (request.status === 'approved') {
            throw new SignupRequestAlreadyActionedError(uuid, request.status);
        }
        return request;
    }

    // Near-duplicate of api/apps/api/organisation/services/organisation.service.ts's
    // createOrganisation() — see that file for the annotated original. Kept in sync manually
    // (see backlogs/onboarding/children/organisation-approval-gate's open questions on this
    // trade-off).
    private async createOrganisationFromApprovedRequest(request: SignupRequest): Promise<Organisation> {
        const isWebsiteProvisioned = request.business_category === 'real-estate';
        const createdAt = new Date().toISOString();

        const org: Organisation = {
            uuid: uuidv4(),
            id: request.organisation_id,
            name: request.organisation_name,
            status: isWebsiteProvisioned ? 'creating-website' : 'ready',
            image: null,
            business_category: request.business_category,
            template_id: request.template_id,
            plan_id: request.plan_id,
            created_at: createdAt,
            address: request.address ?? null,
            market: request.market ?? 'AU',
            ...(request.description && { description: request.description }),
        };

        const membership: OrganisationUser = {
            role: 'owner',
            joined_date: org.created_at,
        };

        const trialEnd = new Date(new Date(org.created_at).getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
        const subscription: Subscription = {
            uuid: uuidv4(),
            organisation_id: org.uuid,
            plan_id: request.plan_id,
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

        try {
            await this.DB_Client.send(
                new TransactWriteCommand({
                    TransactItems: [
                        {
                            Put: {
                                TableName: getTable(),
                                Item: { PK: 'ORG', SK: `META#${org.uuid}`, data: JSON.stringify(org) },
                                ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
                            },
                        },
                        {
                            Put: {
                                TableName: getTable(),
                                Item: { PK: `ORG#ID#${org.id}`, SK: 'META', data: JSON.stringify({ uuid: org.uuid }) },
                                ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
                            },
                        },
                        {
                            Put: {
                                TableName: getTable(),
                                Item: {
                                    PK: `ORG#${org.uuid}`,
                                    SK: `USER#${request.requested_by_user_id}`,
                                    data: JSON.stringify(membership),
                                },
                            },
                        },
                        {
                            Put: {
                                TableName: getTable(),
                                Item: {
                                    PK: `USER#${request.requested_by_email}`,
                                    SK: 'META',
                                    data: JSON.stringify({ user_id: request.requested_by_user_id }),
                                },
                            },
                        },
                        {
                            Put: {
                                TableName: getTable(),
                                Item: {
                                    PK: `USER#${request.requested_by_email}`,
                                    SK: `USER#${request.requested_by_user_id}`,
                                },
                            },
                        },
                        {
                            Put: {
                                TableName: getTable(),
                                Item: {
                                    PK: `ORG#${org.uuid}`,
                                    SK: 'SUBSCRIPTION',
                                    GSI2PK: 'SUBSCRIPTION#TRIALING',
                                    GSI2SK: subscription.trial_end,
                                    data: JSON.stringify(subscription),
                                },
                            },
                        },
                    ],
                }),
            );
        } catch (error: unknown) {
            if (error instanceof TransactionCanceledException) {
                const reasons = error.CancellationReasons ?? [];
                if (reasons[0]?.Code === 'ConditionalCheckFailed' || reasons[1]?.Code === 'ConditionalCheckFailed') {
                    throw new OrganisationAlreadyExistsError(org.id);
                }
            }
            throw error;
        }

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

        return org;
    }
}
