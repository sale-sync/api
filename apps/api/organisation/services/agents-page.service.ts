import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { Service } from '@devyethiha/samjs';
import { markJobFailedToStart, startFailureReason, tryStartPublish } from './publish-status';
import type { AgentsBanner, AgentsPageRecord, SEO } from '@sale-sync/shared/src/types';

// No hardcoded fallback: staging/prod are different tables — same pattern as
// organisation.service.ts's getTable()/home.service.ts's getTable(). Read lazily so tests' env var
// setup is picked up.
function getTable(): string {
    return process.env.ORGANISATION_TABLE_NAME as string;
}

// Same fire-and-forget cross-stack invoke idiom HomeService uses for
// PUBLISH_REAL_ESTATE_HOME_PAGE_FUNCTION_NAME — publish-real-estate-agents-page lives in ss/infra, a
// different SAM app/stack than this one, so there's no CFN GetAtt/import available across the two.
const PUBLISH_REAL_ESTATE_AGENTS_PAGE_FUNCTION_NAME = process.env.PUBLISH_REAL_ESTATE_AGENTS_PAGE_FUNCTION_NAME;
const lambdaClient = new LambdaClient({});

const EMPTY_RECORD: AgentsPageRecord = {
    data: null,
    draft: null,
    updated_at: new Date(0).toISOString(),
    published_at: null,
};

export class NoDraftToPublishError extends Error {
    constructor() {
        super('No draft agents-page changes to publish');
        this.name = 'NoDraftToPublishError';
    }
}

// Mirrors HomeService exactly — singleton per-org record, data/draft split, same publish semantics
// (draft left equal to the just-published value, not nulled), including the fire-and-forget
// regeneration invoke on publish. Unlike Home's Hero (badge/title/subtitle/bannerImage all
// editable), only the banner image + overlay opacity are editable here — title/subtitle on this page
// stay static theme copy. Has its own dedicated 'real-estate-agents-page' generator
// (publish-real-estate-agents-page, see api/libs/shared/src/types/template.ts's PageGenerator)
// rather than reusing 'real-estate-home-page' — see that type's comment for why this isn't a shared
// generator.
export class AgentsPageService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('agents-page');
        this.DB_Client = DB_Client;
    }

    // Singleton per-org record — PK=ORG#{orgUuid}, SK=AGENTS_PAGE. Confirmed no collision with the
    // existing team-member/agent-profile feature (api/apps/api/agents/services/agents.service.ts),
    // which uses SK=AGENT#{agentId} (per-item, different prefix entirely, unrelated feature).
    public async get(orgUuid: string): Promise<AgentsPageRecord> {
        const res = await this.DB_Client.send(
            new GetCommand({
                TableName: getTable(),
                Key: { PK: `ORG#${orgUuid}`, SK: 'AGENTS_PAGE' },
            }),
        );

        return res.Item ? (JSON.parse(res.Item.data as string) as AgentsPageRecord) : EMPTY_RECORD;
    }

    private async put(orgUuid: string, record: AgentsPageRecord): Promise<void> {
        await this.DB_Client.send(
            new PutCommand({
                TableName: getTable(),
                Item: { PK: `ORG#${orgUuid}`, SK: 'AGENTS_PAGE', data: JSON.stringify(record) },
            }),
        );
    }

    public async updateDraft(orgUuid: string, banner: AgentsBanner, seo?: SEO): Promise<AgentsPageRecord> {
        const current = await this.get(orgUuid);

        const updated: AgentsPageRecord = {
            ...current,
            draft: { banner, seo },
            updated_at: new Date().toISOString(),
        };

        await this.put(orgUuid, updated);
        return updated;
    }

    // Flips draft -> data. Leaves `draft` equal to the just-published value (not nulled), same
    // rationale as HomeService.publish(). Also fire-and-forget invokes
    // infra/functions/publish-real-estate-agents-page to bake the newly-published banner into the
    // deployed site's dist/agents HTML and ssr/agents JSON — this method does not wait for that
    // Lambda to finish; see HomeService.publish()'s equivalent comment for the same
    // status-lifecycle caveat (AgentsPageRecord has no status/status_reason field either).
    public async publish(orgUuid: string): Promise<AgentsPageRecord> {
        const current = await this.get(orgUuid);
        if (!current.draft) {
            throw new NoDraftToPublishError();
        }

        const updated: AgentsPageRecord = {
            ...current,
            data: current.draft,
            published_at: new Date().toISOString(),
        };

        await this.put(orgUuid, updated);

        const publishId = await tryStartPublish(
            orgUuid,
            'agents',
            PUBLISH_REAL_ESTATE_AGENTS_PAGE_FUNCTION_NAME ? ['real-estate-agents-page'] : [],
        );

        if (PUBLISH_REAL_ESTATE_AGENTS_PAGE_FUNCTION_NAME) {
            try {
                await lambdaClient.send(
                    new InvokeCommand({
                        FunctionName: PUBLISH_REAL_ESTATE_AGENTS_PAGE_FUNCTION_NAME,
                        InvocationType: 'Event',
                        Payload: JSON.stringify({
                            organisation_uuid: orgUuid,
                            publish_id: publishId,
                            page_key: 'agents',
                        }),
                    }),
                );
            } catch (error) {
                console.error(
                    'Failed to invoke publish-real-estate-agents-page — agents page published, but banner regeneration was not started',
                    error,
                );
                await markJobFailedToStart(
                    orgUuid,
                    'agents',
                    publishId,
                    'real-estate-agents-page',
                    startFailureReason(error),
                );
            }
        }

        return updated;
    }
}
