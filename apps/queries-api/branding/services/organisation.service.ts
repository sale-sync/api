import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import type { Organisation } from '@sale-sync/shared/src/types';

const TABLE = process.env.ORGANISATION_TABLE_NAME || 'sale-sync-organisation';

// Read-only mirror of api/organisation/services/organisation.service.ts's getByUuid — this stack
// never writes to the organisation table (see template.yaml's DynamoDBReadPolicy), so create/update
// methods are deliberately not carried over.
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
                TableName: TABLE,
                Key: { PK: 'ORG', SK: `META#${uuid}` },
            }),
        );

        return res.Item ? (JSON.parse(res.Item.data as string) as Organisation) : null;
    }
}
