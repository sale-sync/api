import { DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { BatchGetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import type { BusinessCategory, Market, SignupRequest } from '@sale-sync/shared/src/types';
import { v4 as uuidv4 } from 'uuid';

// No hardcoded fallback: staging and prod are different literal tables (see samconfig.toml) — a
// default here would mean a misconfigured staging deploy silently writes to the prod table instead
// of erroring. Read lazily (not hoisted to a module-level const) so a test's env var setup (which
// runs after this module is first imported) is still picked up.
function getTable(): string {
    return process.env.ORGANISATION_TABLE_NAME as string;
}

type CreateSignupRequestParam = {
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
};

export class SignupRequestAlreadyExistsError extends Error {
    constructor(organisationId: string) {
        super(`A pending signup request for '${organisationId}' already exists`);
        this.name = 'SignupRequestAlreadyExistsError';
    }
}

export class SignupRequestService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('signup-request');
        this.DB_Client = DB_Client;
    }

    // Atomically write a pending SignupRequest + a per-organisation_id dedup lock + an
    // inverted-index row (for getSignupRequestsByUserId).
    public async createSignupRequest(param: CreateSignupRequestParam): Promise<SignupRequest> {
        const now = new Date().toISOString();
        const signupRequest: SignupRequest = {
            uuid: uuidv4(),
            organisation_id: param.organisation_id,
            organisation_name: param.organisation_name,
            business_category: param.business_category,
            template_id: param.template_id,
            plan_id: param.plan_id,
            market: param.market ?? 'AU',
            status: 'pending',
            requested_by_user_id: param.user_id,
            requested_by_email: param.user_email,
            created_at: now,
            ...(param.description && { description: param.description }),
            ...(param.address && { address: param.address }),
        };

        try {
            await this.DB_Client.send(
                new TransactWriteCommand({
                    TransactItems: [
                        // Canonical record — PK=SIGNUP, SK=META#{uuid}. GSI2PK/GSI2SK feed the
                        // trial-status-index GSI's pending-queue query (GET /signup-requests?status=pending
                        // in admin-api), REMOVE'd once the request is approved/rejected.
                        {
                            Put: {
                                TableName: getTable(),
                                Item: {
                                    PK: 'SIGNUP',
                                    SK: `META#${signupRequest.uuid}`,
                                    GSI2PK: 'SIGNUP#PENDING',
                                    GSI2SK: now,
                                    data: JSON.stringify(signupRequest),
                                },
                                ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
                            },
                        },
                        // Dedup lock — PK=SIGNUP#ID#{organisation_id}, SK=META. Blocks a second concurrent
                        // *pending* request for the same organisation_id; deleted by admin-api when this
                        // request is actioned (approve/reject), so the id can be resubmitted afterwards.
                        {
                            Put: {
                                TableName: getTable(),
                                Item: {
                                    PK: `SIGNUP#ID#${param.organisation_id}`,
                                    SK: 'META',
                                    data: JSON.stringify({ uuid: signupRequest.uuid }),
                                },
                                ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
                            },
                        },
                        // Inverted-index row so getSignupRequestsByUserId can list a caller's own
                        // requests without a new GSI — same idiom as organisation.service.ts's
                        // USER#{email}/USER#{user_id} mapping.
                        {
                            Put: {
                                TableName: getTable(),
                                Item: {
                                    PK: `SIGNUP#${signupRequest.uuid}`,
                                    SK: `USER#${param.user_id}`,
                                },
                            },
                        },
                    ],
                }),
            );
        } catch (error: unknown) {
            if (error instanceof TransactionCanceledException) {
                const reasons = error.CancellationReasons ?? [];
                if (reasons[1]?.Code === 'ConditionalCheckFailed') {
                    throw new SignupRequestAlreadyExistsError(param.organisation_id);
                }
            }
            throw error;
        }

        return signupRequest;
    }

    // List the caller's own signup requests (any status) — via inverted-index,
    // SK=USER#{userId}, PK begins_with SIGNUP#.
    public async getSignupRequestsByUserId(userId: string): Promise<SignupRequest[]> {
        const res = await this.DB_Client.send(
            new QueryCommand({
                TableName: getTable(),
                IndexName: 'inverted-index',
                KeyConditionExpression: 'SK = :sk AND begins_with(PK, :prefix)',
                ExpressionAttributeValues: {
                    ':sk': `USER#${userId}`,
                    ':prefix': 'SIGNUP#',
                },
            }),
        );

        const uuids = (res.Items ?? []).map((it: Record<string, unknown>) => String(it.PK).replace('SIGNUP#', ''));
        if (uuids.length === 0) return [];

        const table = getTable();
        const batch = await this.DB_Client.send(
            new BatchGetCommand({
                RequestItems: {
                    [table]: {
                        Keys: uuids.map((uuid) => ({ PK: 'SIGNUP', SK: `META#${uuid}` })),
                    },
                },
            }),
        );

        return (batch.Responses?.[table] ?? []).map((item: Record<string, unknown>) => JSON.parse(item.data as string) as SignupRequest);
    }
}
