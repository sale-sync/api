import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import type { OrganisationUser } from '@sale-sync/shared/src/types';

const TABLE = process.env.ORGANISATION_TABLE_NAME || 'sale-sync-organisation';

export class InsufficientRoleError extends Error {
    constructor() {
        super('Only owner or admin can manage website branding');
        this.name = 'InsufficientRoleError';
    }
}

// Deliberately duplicated (not imported) from api/organisation/services/organisation.service.ts's
// assertCanManageTeam — no lambda-to-lambda service dependency exists anywhere else in this repo, so a
// local re-implementation was chosen over a cross-lambda import. Re-fetches the membership row from
// DynamoDB rather than trusting the (unverified, jwt-decode-only) Organisation cookie JWT.
export class OrganisationMembershipService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('organisation-membership');
        this.DB_Client = DB_Client;
    }

    public async assertCanManageOrganisation(orgUuid: string, userId: string): Promise<void> {
        const res = await this.DB_Client.send(
            new GetCommand({
                TableName: TABLE,
                Key: { PK: `ORG#${orgUuid}`, SK: `USER#${userId}` },
            }),
        );

        const membership = res.Item ? (JSON.parse(res.Item.data as string) as OrganisationUser) : null;
        if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
            throw new InsufficientRoleError();
        }
    }
}
