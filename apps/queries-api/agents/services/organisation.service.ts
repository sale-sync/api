import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import type { Organisation } from '@sale-sync/shared/src/types';

// No hardcoded fallback: staging and prod are different literal tables — a default here would mean
// a misconfigured staging deploy silently reads the prod table instead of erroring. Same rationale
// as api/apps/api/organisation/services/organisation.service.ts's getTable() (sibling queries-api
// services still have `|| 'sale-sync-organisation'`; not retrofitting those here — out of scope for
// this backlog).
function getTable(): string {
    const table = process.env.ORGANISATION_TABLE_NAME;
    if (!table) throw new Error('ORGANISATION_TABLE_NAME environment variable is not set');
    return table;
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
