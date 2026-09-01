import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import type { Agent, Image, Organisation } from '@sale-sync/shared/src/types';
import { v4 as uuidv4 } from 'uuid';
import { AgentDesignationNotAllowedError, OrganisationService } from '../../organisation/services/organisation.service';

// No hardcoded fallback: staging/prod are different literal tables — see
// api/apps/api/organisation/services/organisation.service.ts's getTable() for the full rationale.
// Read lazily (not hoisted) so a test's env var setup is still picked up.
function getTable(): string {
    const table = process.env.ORGANISATION_TABLE_NAME;
    if (!table) throw new Error('ORGANISATION_TABLE_NAME environment variable is not set');
    return table;
}

export class AgentNotFoundError extends Error {
    constructor() {
        super('Agent not found');
        this.name = 'AgentNotFoundError';
    }
}

// Thrown when a create/link targets a user_id already linked to a *different* agent profile in the
// same organisation — the 1:1 agent<->team-member link invariant (see
// docs/api/dynamodb/access-patterns/agent.md).
export class AgentAlreadyLinkedError extends Error {
    constructor() {
        super('This team member is already linked to another agent profile');
        this.name = 'AgentAlreadyLinkedError';
    }
}

// Thrown when linked_user_id doesn't resolve to an existing membership record — distinct from
// ProfileNotFoundError (organisation.service.ts), which is about the *caller's own* missing
// membership record on self-service profile endpoints, not an arbitrary target user_id here.
export class TargetNotTeamMemberError extends Error {
    constructor() {
        super('The given user_id is not a member of this organisation');
        this.name = 'TargetNotTeamMemberError';
    }
}

type CreateAgentParam = {
    name: string;
    position?: string;
    photo?: Image | null;
    linked_user_id?: string | null;
};

type UpdateAgentParam = {
    name?: string;
    position?: string;
    photo?: Image | null;
};

// Fully decoupled real-estate agent profile (BR-31/32) — replaces the old additive
// OrganisationUser.agent boolean flag entirely (removed, no back-compat). An Agent is its own item,
// PK=ORG#{orgUuid}, SK=AGENT#{agentId}, in the SAME organisation table as team membership — not a
// new table. See docs/api/dynamodb/access-patterns/agent.md.
//
// Deviation from the original spec: `OrganisationService` is NOT taken as a constructor
// dependency here. samjs's Router always instantiates every listed Service as
// `new ServiceClass(DB_Client, db)` (see initializeControllers in
// node_modules/@devyethiha/samjs/dist/chunk-YX54R4YZ.js) — there is no support for one Service
// receiving another Service instance via constructor injection, only Controllers get that (a
// module's `services` array is instantiated independently, then spread into the *controller's*
// constructor). So every method below that needs the owner/admin gate takes an
// `organisationService: OrganisationService` parameter, supplied by the controller — which itself
// legitimately receives both AgentsService and OrganisationService via the module registration in
// app.ts.
export class AgentsService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('agents');
        this.DB_Client = DB_Client;
    }

    // Real-estate-only gate, same rule/lookup shape organisation.service.ts's (now-removed)
    // updateTeamMemberAgentFlag used — PK=ORG, SK=META#{orgUuid}. Reuses
    // AgentDesignationNotAllowedError from organisation.service.ts rather than redefining it. Uses
    // this service's own DB_Client directly (same table) rather than OrganisationService, since this
    // is a plain Get with no role/membership logic involved.
    private async assertRealEstate(orgUuid: string): Promise<void> {
        const orgMeta = await this.DB_Client.send(
            new GetCommand({
                TableName: getTable(),
                Key: { PK: 'ORG', SK: `META#${orgUuid}` },
            }),
        );
        const organisation = orgMeta.Item ? (JSON.parse(orgMeta.Item.data as string) as Organisation) : null;
        if (organisation?.business_category !== 'real-estate') {
            throw new AgentDesignationNotAllowedError();
        }
    }

    // PK=ORG#{orgUuid}, SK begins_with AGENT# — no GSI, same "no GSI needed at this scale"
    // precedent as the old USER#-scanning agent query (see access-patterns/agent.md).
    private async listAgentItems(orgUuid: string): Promise<Agent[]> {
        const res = await this.DB_Client.send(
            new QueryCommand({
                TableName: getTable(),
                KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
                ExpressionAttributeValues: { ':pk': `ORG#${orgUuid}`, ':prefix': 'AGENT#' },
            }),
        );
        return (res.Items ?? []).map((item: Record<string, unknown>) => JSON.parse(item.data as string) as Agent);
    }

    // Verifies `userId` isn't already linked to a different agent in this org. `excludeAgentId` lets
    // linkAgent-style re-links exclude the agent being modified from the conflict check.
    private async assertNotAlreadyLinked(orgUuid: string, userId: string, excludeAgentId?: string): Promise<void> {
        const agents = await this.listAgentItems(orgUuid);
        const conflict = agents.some((a) => a.id !== excludeAgentId && a.linked_user_id === userId);
        if (conflict) {
            throw new AgentAlreadyLinkedError();
        }
    }

    public async createAgent(
        orgUuid: string,
        input: CreateAgentParam,
        callerUserId: string,
        organisationService: OrganisationService,
    ): Promise<Agent> {
        await organisationService.assertCanManageTeam(orgUuid, callerUserId);
        await this.assertRealEstate(orgUuid);

        if (input.linked_user_id) {
            const membership = await organisationService.getMembership(orgUuid, input.linked_user_id);
            if (!membership) {
                throw new TargetNotTeamMemberError();
            }
            await this.assertNotAlreadyLinked(orgUuid, input.linked_user_id);
        }

        const now = new Date().toISOString();
        const agent: Agent = {
            id: uuidv4(),
            org_uuid: orgUuid,
            name: input.name,
            ...(input.position !== undefined && { position: input.position }),
            ...(input.photo !== undefined && { photo: input.photo }),
            linked_user_id: input.linked_user_id ?? null,
            created_at: now,
            updated_at: now,
        };

        await this.DB_Client.send(
            new PutCommand({
                TableName: getTable(),
                Item: { PK: `ORG#${orgUuid}`, SK: `AGENT#${agent.id}`, data: JSON.stringify(agent) },
            }),
        );

        return agent;
    }

    // No owner/admin/real-estate gate — any authenticated org member can view the roster, same
    // stance as GET /organisations/testimonials.
    public async listAgents(orgUuid: string): Promise<Agent[]> {
        return this.listAgentItems(orgUuid);
    }

    public async getAgent(orgUuid: string, agentId: string): Promise<Agent | null> {
        const res = await this.DB_Client.send(
            new GetCommand({
                TableName: getTable(),
                Key: { PK: `ORG#${orgUuid}`, SK: `AGENT#${agentId}` },
            }),
        );
        return res.Item ? (JSON.parse(res.Item.data as string) as Agent) : null;
    }

    public async updateAgent(
        orgUuid: string,
        agentId: string,
        patch: UpdateAgentParam,
        callerUserId: string,
        organisationService: OrganisationService,
    ): Promise<Agent> {
        await organisationService.assertCanManageTeam(orgUuid, callerUserId);
        await this.assertRealEstate(orgUuid);

        const current = await this.getAgent(orgUuid, agentId);
        if (!current) {
            throw new AgentNotFoundError();
        }

        const updated: Agent = {
            ...current,
            ...(patch.name !== undefined && { name: patch.name }),
            ...(patch.position !== undefined && { position: patch.position }),
            ...(patch.photo !== undefined && { photo: patch.photo }),
            updated_at: new Date().toISOString(),
        };

        await this.DB_Client.send(
            new UpdateCommand({
                TableName: getTable(),
                Key: { PK: `ORG#${orgUuid}`, SK: `AGENT#${agentId}` },
                UpdateExpression: 'SET #data = :data',
                ExpressionAttributeNames: { '#data': 'data' },
                ExpressionAttributeValues: { ':data': JSON.stringify(updated) },
            }),
        );

        return updated;
    }

    // Checks existence first (a Get, not a conditional Delete) so a missing agent reliably surfaces
    // as 404 rather than a silently-successful no-op delete.
    public async deleteAgent(
        orgUuid: string,
        agentId: string,
        callerUserId: string,
        organisationService: OrganisationService,
    ): Promise<void> {
        await organisationService.assertCanManageTeam(orgUuid, callerUserId);
        await this.assertRealEstate(orgUuid);

        const current = await this.getAgent(orgUuid, agentId);
        if (!current) {
            throw new AgentNotFoundError();
        }

        await this.DB_Client.send(
            new DeleteCommand({
                TableName: getTable(),
                Key: { PK: `ORG#${orgUuid}`, SK: `AGENT#${agentId}` },
            }),
        );
    }

    // userId === null unlinks. Same membership/conflict checks as createAgent, excluding the agent
    // being linked itself from the "already linked" conflict scan (re-linking the same agent to the
    // same user_id it already has is a no-op, not a conflict).
    public async linkAgent(
        orgUuid: string,
        agentId: string,
        userId: string | null,
        callerUserId: string,
        organisationService: OrganisationService,
    ): Promise<Agent> {
        await organisationService.assertCanManageTeam(orgUuid, callerUserId);
        await this.assertRealEstate(orgUuid);

        const current = await this.getAgent(orgUuid, agentId);
        if (!current) {
            throw new AgentNotFoundError();
        }

        if (userId !== null) {
            const membership = await organisationService.getMembership(orgUuid, userId);
            if (!membership) {
                throw new TargetNotTeamMemberError();
            }
            await this.assertNotAlreadyLinked(orgUuid, userId, agentId);
        }

        const updated: Agent = { ...current, linked_user_id: userId, updated_at: new Date().toISOString() };

        await this.DB_Client.send(
            new UpdateCommand({
                TableName: getTable(),
                Key: { PK: `ORG#${orgUuid}`, SK: `AGENT#${agentId}` },
                UpdateExpression: 'SET #data = :data',
                ExpressionAttributeNames: { '#data': 'data' },
                ExpressionAttributeValues: { ':data': JSON.stringify(updated) },
            }),
        );

        return updated;
    }
}
