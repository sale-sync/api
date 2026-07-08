import { ConditionalCheckFailedException, DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { BatchGetCommand, BatchWriteCommand, GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import type { BusinessCategory, Organisation, OrganisationUser, PendingUser } from '@sale-sync/shared/src/types';
import { v4 as uuidv4 } from 'uuid';

const TABLE = process.env.ORGANISATION_TABLE_NAME || 'sale-sync-organisation';

type CreateOrganisationParam = {
    user_id: string;
    user_email: string;
    organisation_id: string;
    organisation_name: string;
    business_category: BusinessCategory;
    template_id: string;
    plan_id: string;
    description?: string;
};

export class OrganisationAlreadyExistsError extends Error {
    constructor(organisationId: string) {
        super(`Organisation '${organisationId}' already exists`);
        this.name = 'OrganisationAlreadyExistsError';
    }
}

export class OrganisationService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('organisation');
        this.DB_Client = DB_Client;
    }

    public async createOrganisation(param: CreateOrganisationParam): Promise<void> {
        const org: Organisation = {
            uuid: uuidv4(),
            id: param.organisation_id,
            name: param.organisation_name,
            status: 'pending',
            image: null,
            business_category: param.business_category,
            template_id: param.template_id,
            plan_id: param.plan_id,
            created_at: new Date().toISOString(),
            ...(param.description && { description: param.description }),
        };

        const membership: OrganisationUser = {
            role: 'owner',
            joined_date: org.created_at,
        };

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
                                    uuid: org.uuid,
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
                                    user_id: param.user_id,
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
                    ],
                }),
            );
        } catch (error: unknown) {
            if (
                error instanceof TransactionCanceledException &&
                error.CancellationReasons?.some((r) => r.Code === 'ConditionalCheckFailed')
            ) {
                throw new OrganisationAlreadyExistsError(param.organisation_id);
            }
            throw error;
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

        const meta = await this.DB_Client.send(
            new GetCommand({
                TableName: TABLE,
                Key: { PK: 'ORG', SK: `META#${lookup.Item.uuid}` },
            }),
        );

        return meta.Item ? (JSON.parse(meta.Item.data) as Organisation) : null;
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

    // Lookup user by email — PK=USER#{email}, SK=META
    public async getUserByEmail(email: string): Promise<{ user_id: string } | null> {
        const res = await this.DB_Client.send(
            new GetCommand({
                TableName: TABLE,
                Key: { PK: `USER#${email}`, SK: 'META' },
            }),
        );

        return res.Item ? { user_id: res.Item.user_id as string } : null;
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

    // Add team members by email — PK=USER#{email}, SK=META to resolve user_id
    // Registered users  → PK=ORG#{orgUuid}, SK=USER#{user_id}, data=OrganisationUser
    // Unregistered users → PK=ORG#{orgUuid}, SK=USER#{email},   data=PendingUser
    public async addTeamMembers(
        orgUuid: string,
        emails: string[],
    ): Promise<{ added: string[]; pending: string[] }> {
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
            registeredMap.set(email, item.user_id as string);
        }

        const now = new Date().toISOString();
        const writeRequests = emails.map((email) => {
            const userId = registeredMap.get(email);
            if (userId) {
                const membership: OrganisationUser = { role: 'staff', joined_date: now };
                return {
                    PutRequest: {
                        Item: { PK: `ORG#${orgUuid}`, SK: `USER#${userId}`, data: JSON.stringify(membership) },
                    },
                };
            } else {
                const pending: PendingUser = { status: 'pending' };
                return {
                    PutRequest: {
                        Item: { PK: `ORG#${orgUuid}`, SK: `USER#${email}`, data: JSON.stringify(pending) },
                    },
                };
            }
        });

        await this.DB_Client.send(
            new BatchWriteCommand({ RequestItems: { [TABLE]: writeRequests } }),
        );

        return {
            added: emails.filter((e) => registeredMap.has(e)),
            pending: emails.filter((e) => !registeredMap.has(e)),
        };
    }
}
