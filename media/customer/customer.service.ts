import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchGetCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import { v4 as uuidv4 } from 'uuid';

export interface ICustomerService {
    createContact: (param: CreatUserParam) => void;
    addCustomer: (param: CreatUserParam) => void;
    getContactsWorkspaceId(
        userId: string,
        options?: {
            hydrate?: boolean;
        },
    ): Promise<any>;
}

type CreatUserParam = {
    user_id: string;
    workspace_id: string;
    workspace_name: string;
};

export class CustomerService extends Service implements ICustomerService {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('workspace');
        this.DB_Client = DB_Client;
    }

    public async createContact(param: CreatUserParam) {
        try {
            const data = {
                uuid: uuidv4(),
                id: param.workspace_id,
                name: param.workspace_name,
            };

            await this.DB_Client.send(
                new PutCommand({
                    TableName: 'sales-sync-workspace',
                    Item: {
                        pk: 'WORKSPACE',
                        sk: 'META#' + data.id,
                        data: JSON.stringify(data),
                    },
                }),
            );

            await this.DB_Client.send(
                new PutCommand({
                    TableName: 'sales-sync-workspace',
                    Item: {
                        pk: 'WORKSPACE#' + data.id,
                        sk: 'USER#' + param.user_id,
                    },
                }),
            );
        } catch (error) {
            console.log({ error });
            throw Error(JSON.stringify(error));
        }
    }
    public async addCustomer(param: CreatUserParam) {
        try {
            const data = {
                uuid: uuidv4(),
                id: param.workspace_id,
                name: param.workspace_name,
            };

            await this.DB_Client.send(
                new PutCommand({
                    TableName: 'sales-sync-workspace',
                    Item: {
                        pk: 'WORKSPACE',
                        sk: 'META#' + data.id,
                        data: JSON.stringify(data),
                    },
                }),
            );

            await this.DB_Client.send(
                new PutCommand({
                    TableName: 'sales-sync-workspace',
                    Item: {
                        pk: 'WORKSPACE#' + data.id,
                        sk: 'USER#' + param.user_id,
                    },
                }),
            );
        } catch (error) {
            console.log({ error });
            throw Error(JSON.stringify(error));
        }
    }

    // ---------------------------------------------------------
    // Get all workspaces a user belongs to
    //    (Use GSI with sk as the HASH key -> query by "#USER#<userId>")
    //    Membership items show on the GSI as:
    //      gsi partition (sk) = "USER#<userId>"
    //      gsi sort      (pk) = "WORKSPACE#<wsId>"
    //    Optionally hydrate workspace metadata via BatchGet
    // ---------------------------------------------------------
    public async getContactsWorkspaceId(userId: string, options?: { hydrate?: boolean }) {
        const skUser = `USER#${userId}`;

        const res = await this.DB_Client.send(
            new QueryCommand({
                TableName: 'sales-sync-workspace',
                IndexName: 'inverted-index',
                KeyConditionExpression: 'sk = :skUser AND begins_with(pk, :wsPrefix)',
                ExpressionAttributeValues: {
                    ':skUser': skUser,
                    ':wsPrefix': `WORKSPACE#`,
                },
            }),
        );

        const workspaceIds = res.Items?.map((it) => String(it.pk).replace(`WORKSPACE#`, '')) ?? [];

        // Fast path: just IDs
        if (!options?.hydrate || workspaceIds.length === 0) {
            return { userId, workspaces: workspaceIds };
        }

        // Hydrate: fetch workspace metadata rows:
        //   pk = "WORKSPACE", sk = "META#<wsId>"
        const keys = workspaceIds.map((id) => ({
            pk: 'WORKSPACE',
            sk: `META#${id}`,
        }));

        const batch = await this.DB_Client.send(
            new BatchGetCommand({
                RequestItems: {
                    ['sales-sync-workspace']: {
                        Keys: keys,
                    },
                },
            }),
        );

        const items = batch.Responses?.['sales-sync-workspace'] ?? [];
        // If you stored the workspace blob under "data" as JSON string, parse it safely
        const workspaces = items.map((item: any) => {
            try {
                return item.data ? JSON.parse(item.data) : { id: String(item.sk).replace(`META#`, '') };
            } catch {
                return { id: String(item.sk).replace(`META#`, '') };
            }
        });

        return workspaces ?? [];
    }
}
