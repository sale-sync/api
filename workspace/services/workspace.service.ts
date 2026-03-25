// workspace/services/workspace.service.ts

import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchGetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import { v4 as uuidv4 } from 'uuid';

type CreateWorkspaceParam = {
    user_id: string;
    workspace_id: string;
    workspace_name: string;
};

export class WorkspaceAlreadyExistsError extends Error {
    constructor(workspaceId: string) {
        super(`Workspace '${workspaceId}' already exists`);
        this.name = 'WorkspaceAlreadyExistsError';
    }
}

export class WorkspaceService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('workspace');
        this.DB_Client = DB_Client;
    }

    public async createWorkSpace(param: CreateWorkspaceParam): Promise<void> {
        const data = {
            uuid: uuidv4(),
            id: param.workspace_id,
            name: param.workspace_name,
        };

        try {
            await this.DB_Client.send(
                new PutCommand({
                    TableName: 'sales-sync-workspace',
                    Item: {
                        pk: 'WORKSPACE',
                        sk: 'META#' + data.id,
                        data: JSON.stringify(data),
                    },
                    ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
                }),
            );
        } catch (error) {
            if (error instanceof ConditionalCheckFailedException) {
                throw new WorkspaceAlreadyExistsError(param.workspace_id);
            }
            throw error;
        }

        await this.DB_Client.send(
            new PutCommand({
                TableName: 'sales-sync-workspace',
                Item: {
                    pk: 'WORKSPACE#' + data.id,
                    sk: 'USER#' + param.user_id,
                },
            }),
        );
    }

    /**
     * Get all workspaces a user belongs to
     * Uses GSI with sk as the HASH key -> query by "USER#<userId>"
     * Optionally hydrate workspace metadata via BatchGet
     */
    public async getWorkspacesByUserId(userId: string, options?: { hydrate?: boolean }) {
        const skUser = `USER#${userId}`;

        const res = await this.DB_Client.send(
            new QueryCommand({
                TableName: 'sales-sync-workspace',
                IndexName: 'inverted-index',
                KeyConditionExpression: 'sk = :skUser AND begins_with(pk, :wsPrefix)',
                ExpressionAttributeValues: {
                    ':skUser': skUser,
                    ':wsPrefix': 'WORKSPACE#',
                },
            }),
        );

        const workspaceIds = res.Items?.map((it) => String(it.pk).replace('WORKSPACE#', '')) ?? [];

        if (!options?.hydrate || workspaceIds.length === 0) {
            return { userId, workspaces: workspaceIds };
        }

        const keys = workspaceIds.map((id) => ({
            pk: 'WORKSPACE',
            sk: `META#${id}`,
        }));

        const batch = await this.DB_Client.send(
            new BatchGetCommand({
                RequestItems: {
                    'sales-sync-workspace': {
                        Keys: keys,
                    },
                },
            }),
        );

        const items = batch.Responses?.['sales-sync-workspace'] ?? [];

        const workspaces = items.map((item: any) => {
            try {
                return item.data ? JSON.parse(item.data) : { id: String(item.sk).replace('META#', '') };
            } catch {
                return { id: String(item.sk).replace('META#', '') };
            }
        });

        return workspaces;
    }
}
