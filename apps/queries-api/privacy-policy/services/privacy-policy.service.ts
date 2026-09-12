import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import type { PrivacyPolicyRecord } from '@sale-sync/shared/src/types';

// No hardcoded fallback: staging and prod use different literal table names — see
// api/apps/api/organisation/services/organisation.service.ts's getTable() for the full rationale.
// ORGANISATION_TABLE_NAME is always set via queries.template.yaml's Globals, so this only ever fails
// loud in a genuinely misconfigured deploy rather than silently reading the wrong table.
function getTable(): string {
    return process.env.ORGANISATION_TABLE_NAME as string;
}

const EMPTY_RECORD: PrivacyPolicyRecord = {
    data: null,
    draft: null,
    updated_at: new Date(0).toISOString(),
    published_at: null,
};

// Read-only mirror of api/organisation/services/privacy-policy.service.ts's get() — this stack
// never writes privacy-policy content (see queries.template.yaml's DynamoDBReadPolicy), so
// put/updateDraft/publish are deliberately not carried over. Callers must only ever read `.data`
// (published), never `.draft`.
export class PrivacyPolicyService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('privacy-policy');
        this.DB_Client = DB_Client;
    }

    // Singleton per-org record — PK=ORG#{orgUuid}, SK=PRIVACY_POLICY
    public async get(orgUuid: string): Promise<PrivacyPolicyRecord> {
        const res = await this.DB_Client.send(
            new GetCommand({
                TableName: getTable(),
                Key: { PK: `ORG#${orgUuid}`, SK: 'PRIVACY_POLICY' },
            }),
        );

        return res.Item ? (JSON.parse(res.Item.data as string) as PrivacyPolicyRecord) : EMPTY_RECORD;
    }
}
