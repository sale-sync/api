import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { Agent, Organisation } from '@sale-sync/shared/src/types';
import { lambdaHandler } from '../../app';

// Pins the public-visibility invariant documented on AgentsService.getPublicAgents and
// docs/api/dynamodb/access-patterns/agent.md: GET /agents reads ONLY AGENT# items — a plain team
// member with no Agent record must never appear, and an Agent record with linked_user_id: null
// (no linked account at all) must still appear, using its own fields as authoritative.
const ddbMock = mockClient(DynamoDBClient);

const ORG_UUID = 'org-uuid-1';

function fakeJwt(payload: Record<string, unknown>): string {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${header}.${body}.fake-signature`;
}

function buildEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
    const token = fakeJwt({ organisation_id: 'potato-rocket', user_id: 'user-1', uuid: ORG_UUID });
    return {
        httpMethod: 'GET',
        path: '/agents',
        headers: { origin: 'https://client-site.example.com', authorization: `Bearer ${token}` },
        multiValueHeaders: {},
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        pathParameters: null,
        stageVariables: null,
        requestContext: {} as APIGatewayProxyEvent['requestContext'],
        resource: '',
        body: null,
        isBase64Encoded: false,
        ...overrides,
    };
}

const sampleOrg: Organisation = {
    uuid: ORG_UUID,
    id: 'potato-rocket',
    name: 'Potato Rocket',
    status: 'ready',
    image: null,
    business_category: 'real-estate',
    template_id: '11111111-1111-4111-8111-111111111111',
    plan_id: '22222222-2222-4222-8222-222222222222',
    created_at: '2026-01-01T00:00:00.000Z',
    address: null,
    market: 'AU',
};

// (b) — no linked account at all, still authoritative and publicly visible.
const unlinkedAgent: Agent = {
    id: 'agent-uuid-1',
    org_uuid: ORG_UUID,
    name: 'Nichapa Suksawat',
    position: 'Senior Agent',
    photo: { name: 'headshot.jpg', url: 'https://cdn.example.com/headshot.jpg', size: '1024', mime_type: 'image/jpeg' },
    linked_user_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
    ddbMock.reset();
    process.env.ORGANISATION_TABLE_NAME = 'sale-sync-organisation';
});

describe('GET /agents', () => {
    it('returns only Agent records — a plain team member with no Agent record never appears, and an unlinked Agent still does', async () => {
        ddbMock
            .on(GetCommand, { Key: { PK: 'ORG', SK: `META#${ORG_UUID}` } })
            .resolves({ Item: { data: JSON.stringify(sampleOrg) } });
        // Real DynamoDB would never return the plain USER# team-member item here — the query's
        // KeyConditionExpression restricts SK to begins_with('AGENT#'). Asserting the query args
        // below (not just the response) is what actually pins that the service never reads USER#.
        ddbMock.on(QueryCommand).resolves({ Items: [{ data: JSON.stringify(unlinkedAgent) }] });

        const res = await lambdaHandler(buildEvent());

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual([{ name: 'Nichapa Suksawat', role: 'Senior Agent', photo: 'https://cdn.example.com/headshot.jpg' }]);
        expect(ddbMock).toHaveReceivedCommandWith(QueryCommand, {
            KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
            ExpressionAttributeValues: { ':pk': `ORG#${ORG_UUID}`, ':prefix': 'AGENT#' },
        });
    });

    it('returns [] when the organisation is not found', async () => {
        ddbMock.on(GetCommand).resolves({});

        const res = await lambdaHandler(buildEvent());

        expect(res.statusCode).toBe(404);
    });
});
