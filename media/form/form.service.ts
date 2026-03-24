import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import { v4 as uuidv4 } from 'uuid';
import { ICreateFormDto } from './form.dto';
import { IFormObj } from '@sales-sync/shared';

export interface IFormService {
    createForm: (param: ICreateFormDto) => Promise<IFormObj>;
    getForms: (workspace_uuid: string) => Promise<IFormObj[]>;
}

export class FormService extends Service implements IFormService {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('form');
        this.DB_Client = DB_Client;
    }

    public async createForm(param: ICreateFormDto) {
        try {
            const data: IFormObj = {
                id: uuidv4(),
                ...param,
            };

            await this.DB_Client.send(
                new PutCommand({
                    TableName: 'sales-sync-crm',
                    Item: {
                        pk: `WORKSPACE#${param.workspace_uuid}#FORM`,
                        sk: `FORM#${data.id}`,
                        data: JSON.stringify(data),
                    },
                }),
            );
            return data;
        } catch (error) {
            console.log({ error });
            throw Error(JSON.stringify(error));
        }
    }

    public async getForms(workspace_uuid: string): Promise<IFormObj[]> {
        try {
            const command = new QueryCommand({
                TableName: 'sales-sync-crm',
                KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
                ExpressionAttributeValues: {
                    ':pk': `WORKSPACE#${workspace_uuid}#FORM`,
                    ':skPrefix': 'FORM#',
                },
            });

            const res = await this.DB_Client.send(command);
            const items = res.Items ?? [];

            const formList = items.map((it) => JSON.parse(it.data as string) as IFormObj);

            return formList;
        } catch (error) {
            console.error('Failed to get form list', error);
            throw Error('Failed to get form list');
        }
    }
}
