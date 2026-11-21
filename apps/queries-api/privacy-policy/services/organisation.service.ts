import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import type { Organisation } from '@sale-sync/shared/src/types';

// No hardcoded fallback — see privacy-policy.service.ts in this same directory for the full rationale.
function getTable(): string {
    return process.env.ORGANISATION_TABLE_NAME as string;
}

// Read-only mirror of api/organisation/services/organisation.service.ts's getByUuid — this stack
// never writes to the organisation table (see queries.template.yaml's DynamoDBReadPolicy), so
// create/update methods are deliberately not carried over.
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
