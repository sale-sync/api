import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import type { Agent } from '@sale-sync/shared/src/types';

function getTable(): string {
    const table = process.env.ORGANISATION_TABLE_NAME;
    if (!table) throw new Error('ORGANISATION_TABLE_NAME environment variable is not set');
    return table;
}

// Public profile shape for BR-32 — deliberately no contact info (phone/email): that's left to the
// separate, not-yet-built agent-appointment-scheduling backlog (BR-33). Field names
// (`name`/`role`/`photo`) match what theme-maker/real-estate's actions/team-grid.ts already expects
// — `role` here is the Agent's job title (`Agent.position`), never any access-control role. This
// shape is a stable public contract — theme-maker/real-estate/actions/team-grid.ts and
// clients/home-thailand-estates/actions/team-grid.ts (outside this repo) depend on it via
// `a.name`/`a.role`/`a.photo` and MUST NOT change.
export type AgentProfile = {
    name: string | null;
    role: string | null;
    photo: string | null;
};

// Read-only — lists an organisation's Agent profiles for its public site. This stack never writes
// to the organisation table (see queries.template.yaml's DynamoDBReadPolicy).
//
// Invariant (see docs/api/dynamodb/access-patterns/agent.md): this endpoint must NEVER read USER#
// (team membership) items or join back to OrganisationUser for fallback fields, even for
// real-estate staff. A team member with no Agent record never appears here; an Agent record with
// linked_user_id: null (no account at all) still appears. The Agent item's own fields are always
// authoritative — there is no fallback to any linked account's profile fields.
export class AgentsService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('agents');
        this.DB_Client = DB_Client;
    }

    // Query PK=ORG#{orgUuid}, SK begins_with AGENT# — no GSI on this at current scale (see
    // docs/api/dynamodb/access-patterns/agent.md).
    public async getPublicAgents(orgUuid: string): Promise<AgentProfile[]> {
        const res = await this.DB_Client.send(
            new QueryCommand({
                TableName: getTable(),
                KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
                ExpressionAttributeValues: {
                    ':pk': `ORG#${orgUuid}`,
                    ':prefix': 'AGENT#',
                },
            }),
        );

        return (res.Items ?? [])
            .map((item: Record<string, unknown>) => JSON.parse(item.data as string) as Agent)
            .map((agent) => ({
                name: agent.name ?? null,
                role: agent.position ?? null,
                photo: agent.photo?.url ?? null,
            }));
    }
}
