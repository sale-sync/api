import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchGetCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import { v4 as uuidv4 } from 'uuid';

export interface ICustomerService {
    createContact: (param: CreatUserParam) => void;
    addCustomer: (param: CreatUserParam) => void;
    getContactsOrganisationId(
        userId: string,
        options?: {
            hydrate?: boolean;
        },
    ): Promise<any>;
}

type CreatUserParam = {
    user_id: string;
    organisation_id: string;
    organisation_name: string;
};

export class CustomerService extends Service implements ICustomerService {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('organisation');
        this.DB_Client = DB_Client;
    }

    public async createContact(param: CreatUserParam) {
        try {
            const data = {
                uuid: uuidv4(),
                id: param.organisation_id,
                name: param.organisation_name,
            };

            await this.DB_Client.send(
                new PutCommand({
                    TableName: 'sales-sync-organisation',
                    Item: {
                        pk: 'ORGANISATION',
                        sk: 'META#' + data.id,
                        data: JSON.stringify(data),
                    },
                }),
            );

            await this.DB_Client.send(
                new PutCommand({
                    TableName: 'sales-sync-organisation',
                    Item: {
                        pk: 'ORGANISATION#' + data.id,
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
                id: param.organisation_id,
                name: param.organisation_name,
            };

            await this.DB_Client.send(
                new PutCommand({
                    TableName: 'sales-sync-organisation',
                    Item: {
                        pk: 'ORGANISATION',
                        sk: 'META#' + data.id,
                        data: JSON.stringify(data),
                    },
                }),
            );

            await this.DB_Client.send(
                new PutCommand({
                    TableName: 'sales-sync-organisation',
                    Item: {
                        pk: 'ORGANISATION#' + data.id,
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
    // Get all organisations a user belongs to
    //    (Use GSI with sk as the HASH key -> query by "#USER#<userId>")
    //    Membership items show on the GSI as:
    //      gsi partition (sk) = "USER#<userId>"
    //      gsi sort      (pk) = "ORGANISATION#<orgId>"
    //    Optionally hydrate organisation metadata via BatchGet
    // ---------------------------------------------------------
    public async getContactsOrganisationId(userId: string, options?: { hydrate?: boolean }) {
        const skUser = `USER#${userId}`;

        const res = await this.DB_Client.send(
            new QueryCommand({
                TableName: 'sales-sync-organisation',
                IndexName: 'inverted-index',
                KeyConditionExpression: 'sk = :skUser AND begins_with(pk, :orgPrefix)',
                ExpressionAttributeValues: {
                    ':skUser': skUser,
                    ':orgPrefix': `ORGANISATION#`,
                },
            }),
        );

        const organisationIds = res.Items?.map((it) => String(it.pk).replace(`ORGANISATION#`, '')) ?? [];

        // Fast path: just IDs
        if (!options?.hydrate || organisationIds.length === 0) {
            return { userId, organisations: organisationIds };
        }

        // Hydrate: fetch organisation metadata rows:
        //   pk = "ORGANISATION", sk = "META#<orgId>"
        const keys = organisationIds.map((id) => ({
            pk: 'ORGANISATION',
            sk: `META#${id}`,
        }));

        const batch = await this.DB_Client.send(
            new BatchGetCommand({
                RequestItems: {
                    ['sales-sync-organisation']: {
                        Keys: keys,
                    },
                },
            }),
        );

        const items = batch.Responses?.['sales-sync-organisation'] ?? [];
        const organisations = items.map((item: any) => {
            try {
                return item.data ? JSON.parse(item.data) : { id: String(item.sk).replace(`META#`, '') };
            } catch {
                return { id: String(item.sk).replace(`META#`, '') };
            }
        });

        return organisations ?? [];
    }
}
