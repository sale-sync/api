import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import type { Organisation } from '@sale-sync/shared/src/types';
import { getTable } from './table';

// Read-only mirror of api/organisation/services/organisation.service.ts's getByUuid, same as
// queries-api's copy. This stack never writes the organisation record itself.
export class OrganisationService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('organisation');
        this.DB_Client = DB_Client;
    }

    // PK=ORG, SK=META#{uuid}
    public async getByUuid(uuid: string): Promise<Organisation | null> {
        const res = await this.DB_Client.send(
            new GetCommand({
                TableName: getTable(),
                Key: { PK: 'ORG', SK: `META#${uuid}` },
            }),
        );

        return res.Item ? (JSON.parse(res.Item.data as string) as Organisation) : null;
    }
}
