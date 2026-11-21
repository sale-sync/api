import type { Image } from './organisation';

// Fully decoupled real-estate agent profile (BR-31/32) — replaces the old additive
// `OrganisationUser.agent?: boolean` flag. An Agent is its own entity: it can exist with no
// linked account at all (name/position/photo only), and can optionally be linked later to an
// existing team member's user_id via `linked_user_id`. See
// docs/api/dynamodb/access-patterns/agent.md for the DynamoDB item shape
// (PK=ORG#{org_uuid}, SK=AGENT#{agent_id}).
export type Agent = {
    id: string; // uuid, server-generated
    org_uuid: string;
    name: string; // required — independent of any linked account
    position?: string; // job title, shown publicly as `role`
    photo?: Image | null; // separate from any account avatar
    linked_user_id?: string | null; // optional link to an existing team member's user_id
    created_at: string;
    updated_at: string;
};
