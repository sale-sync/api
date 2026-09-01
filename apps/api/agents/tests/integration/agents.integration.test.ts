import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { Agent, Organisation } from '@sale-sync/shared/src/types';
import { lambdaHandler } from '../../app';

// `uuid@13` ships ESM-only — same Jest CJS-require workaround as organisation's own integration
// suite. We don't assert on the generated uuid's exact value anywhere but the create-agent id.
jest.mock('uuid', () => ({ v4: () => 'mocked-agent-uuid' }));

const ddbMock = mockClient(DynamoDBClient);

const ALLOWED_ORIGIN = 'http://localhost:3000';
const ORG_UUID = 'org-uuid-1';
const OWNER_USER_ID = 'user-1';
const STAFF_USER_ID = 'user-3';
const TARGET_USER_ID = 'user-2';
const AGENT_ID = 'agent-uuid-1';

function fakeJwt(payload: Record<string, unknown>): string {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${header}.${body}.fake-signature`;
}

function buildEvent(callerUserId: string, overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
    const identifierJwt = fakeJwt({ sub: callerUserId, name: 'Test User', email: 'user@example.com', email_verified: true });
    const organisationJwt = fakeJwt({ organisation_id: 'potato-rocket', user_id: callerUserId, uuid: ORG_UUID });
    return {
        httpMethod: 'GET',
        path: '/agents',
        headers: {
            origin: ALLOWED_ORIGIN,
            cookie: `Authentication=fake-token; Identifier=${identifierJwt}; Organisation=${organisationJwt}`,
        },
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

const realEstateOrg: Organisation = {
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

const nonRealEstateOrg: Organisation = { ...realEstateOrg, business_category: 'service-business' };

const ownerMembership = { role: 'owner', joined_date: '2026-01-01T00:00:00.000Z' };
const staffMembership = { role: 'staff', joined_date: '2026-01-01T00:00:00.000Z' };
const targetMembership = { role: 'staff', joined_date: '2026-01-02T00:00:00.000Z' };

const sampleAgent: Agent = {
    id: AGENT_ID,
    org_uuid: ORG_UUID,
    name: 'Nichapa Suksawat',
    position: 'Senior Agent',
    photo: null,
    linked_user_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
};

function mockOwnerAndOrg(org: Organisation = realEstateOrg): void {
    ddbMock
        .on(GetCommand, { Key: { PK: `ORG#${ORG_UUID}`, SK: `USER#${OWNER_USER_ID}` } })
        .resolves({ Item: { data: JSON.stringify(ownerMembership) } })
        .on(GetCommand, { Key: { PK: 'ORG', SK: `META#${ORG_UUID}` } })
        .resolves({ Item: { data: JSON.stringify(org) } });
}

beforeEach(() => {
    ddbMock.reset();
    process.env.ORGANISATION_TABLE_NAME = 'sale-sync-organisation';
});

describe('GET /agents', () => {
    it('returns 200 with the list of agents', async () => {
        ddbMock.on(QueryCommand).resolves({ Items: [{ data: JSON.stringify(sampleAgent) }] });

        const res = await lambdaHandler(buildEvent(OWNER_USER_ID, { httpMethod: 'GET', path: '/agents' }));

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual([sampleAgent]);
    });

    it('returns 401 when unauthenticated', async () => {
        const res = await lambdaHandler(
            buildEvent(OWNER_USER_ID, { httpMethod: 'GET', path: '/agents', headers: { origin: ALLOWED_ORIGIN } }),
        );

        expect(res.statusCode).toBe(401);
    });
});

describe('POST /agents', () => {
    const validBody = { name: 'Nichapa Suksawat', position: 'Senior Agent' };

    it('returns 201 and creates a standalone agent (no linked_user_id)', async () => {
        mockOwnerAndOrg();
        ddbMock.on(PutCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent(OWNER_USER_ID, { httpMethod: 'POST', path: '/agents', body: JSON.stringify(validBody) }),
        );

        expect(res.statusCode).toBe(201);
        const body = JSON.parse(res.body);
        expect(body).toMatchObject({ id: 'mocked-agent-uuid', org_uuid: ORG_UUID, name: 'Nichapa Suksawat', linked_user_id: null });
        expect(ddbMock).toHaveReceivedCommandWith(PutCommand, {
            Item: expect.objectContaining({ PK: `ORG#${ORG_UUID}`, SK: 'AGENT#mocked-agent-uuid' }),
        });
    });

    it('returns 201 and links to an existing team member when linked_user_id is a real member', async () => {
        mockOwnerAndOrg();
        ddbMock
            .on(GetCommand, { Key: { PK: `ORG#${ORG_UUID}`, SK: `USER#${TARGET_USER_ID}` } })
            .resolves({ Item: { data: JSON.stringify(targetMembership) } });
        ddbMock.on(QueryCommand).resolves({ Items: [] });
        ddbMock.on(PutCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent(OWNER_USER_ID, {
                httpMethod: 'POST',
                path: '/agents',
                body: JSON.stringify({ ...validBody, linked_user_id: TARGET_USER_ID }),
            }),
        );

        expect(res.statusCode).toBe(201);
        expect(JSON.parse(res.body).linked_user_id).toBe(TARGET_USER_ID);
    });

    it('returns 400 when name is missing', async () => {
        const res = await lambdaHandler(
            buildEvent(OWNER_USER_ID, { httpMethod: 'POST', path: '/agents', body: JSON.stringify({}) }),
        );

        expect(res.statusCode).toBe(400);
        expect(ddbMock).not.toHaveReceivedCommand(PutCommand);
    });

    it('returns 403 when the caller is not an owner/admin', async () => {
        ddbMock
            .on(GetCommand, { Key: { PK: `ORG#${ORG_UUID}`, SK: `USER#${STAFF_USER_ID}` } })
            .resolves({ Item: { data: JSON.stringify(staffMembership) } });

        const res = await lambdaHandler(
            buildEvent(STAFF_USER_ID, { httpMethod: 'POST', path: '/agents', body: JSON.stringify(validBody) }),
        );

        expect(res.statusCode).toBe(403);
    });

    it('returns 422 when the organisation is not real-estate', async () => {
        mockOwnerAndOrg(nonRealEstateOrg);

        const res = await lambdaHandler(
            buildEvent(OWNER_USER_ID, { httpMethod: 'POST', path: '/agents', body: JSON.stringify(validBody) }),
        );

        expect(res.statusCode).toBe(422);
    });

    it('returns 404 when linked_user_id is not an actual member of the organisation', async () => {
        mockOwnerAndOrg();
        ddbMock.on(GetCommand, { Key: { PK: `ORG#${ORG_UUID}`, SK: `USER#not-a-member` } }).resolves({});

        const res = await lambdaHandler(
            buildEvent(OWNER_USER_ID, {
                httpMethod: 'POST',
                path: '/agents',
                body: JSON.stringify({ ...validBody, linked_user_id: 'not-a-member' }),
            }),
        );

        expect(res.statusCode).toBe(404);
    });

    it('returns 409 when linked_user_id is already linked to a different agent', async () => {
        mockOwnerAndOrg();
        ddbMock
            .on(GetCommand, { Key: { PK: `ORG#${ORG_UUID}`, SK: `USER#${TARGET_USER_ID}` } })
            .resolves({ Item: { data: JSON.stringify(targetMembership) } });
        ddbMock.on(QueryCommand).resolves({
            Items: [{ data: JSON.stringify({ ...sampleAgent, id: 'other-agent', linked_user_id: TARGET_USER_ID }) }],
        });

        const res = await lambdaHandler(
            buildEvent(OWNER_USER_ID, {
                httpMethod: 'POST',
                path: '/agents',
                body: JSON.stringify({ ...validBody, linked_user_id: TARGET_USER_ID }),
            }),
        );

        expect(res.statusCode).toBe(409);
    });

    it('returns 401 when unauthenticated', async () => {
        const res = await lambdaHandler(
            buildEvent(OWNER_USER_ID, {
                httpMethod: 'POST',
                path: '/agents',
                headers: { origin: ALLOWED_ORIGIN },
                body: JSON.stringify(validBody),
            }),
        );

        expect(res.statusCode).toBe(401);
    });
});

describe('GET /agents/by-id', () => {
    it('returns 200 with the agent', async () => {
        ddbMock
            .on(GetCommand, { Key: { PK: `ORG#${ORG_UUID}`, SK: `AGENT#${AGENT_ID}` } })
            .resolves({ Item: { data: JSON.stringify(sampleAgent) } });

        const res = await lambdaHandler(
            buildEvent(OWNER_USER_ID, { httpMethod: 'GET', path: '/agents/by-id', queryStringParameters: { id: AGENT_ID } }),
        );

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual(sampleAgent);
    });

    it('returns 404 for an unknown agent id', async () => {
        ddbMock.on(GetCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent(OWNER_USER_ID, {
                httpMethod: 'GET',
                path: '/agents/by-id',
                queryStringParameters: { id: 'nonexistent' },
            }),
        );

        expect(res.statusCode).toBe(404);
    });

    it('returns 400 when the id query parameter is missing', async () => {
        const res = await lambdaHandler(
            buildEvent(OWNER_USER_ID, { httpMethod: 'GET', path: '/agents/by-id', queryStringParameters: null }),
        );

        expect(res.statusCode).toBe(400);
    });
});

describe('PATCH /agents/by-id', () => {
    it('returns 200 and updates the agent', async () => {
        mockOwnerAndOrg();
        ddbMock
            .on(GetCommand, { Key: { PK: `ORG#${ORG_UUID}`, SK: `AGENT#${AGENT_ID}` } })
            .resolves({ Item: { data: JSON.stringify(sampleAgent) } });
        ddbMock.on(UpdateCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent(OWNER_USER_ID, {
                httpMethod: 'PATCH',
                path: '/agents/by-id',
                queryStringParameters: { id: AGENT_ID },
                body: JSON.stringify({ position: 'Lead Agent' }),
            }),
        );

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).position).toBe('Lead Agent');
        expect(ddbMock).toHaveReceivedCommandWith(UpdateCommand, {
            Key: { PK: `ORG#${ORG_UUID}`, SK: `AGENT#${AGENT_ID}` },
        });
    });

    it('returns 404 when the agent does not exist', async () => {
        mockOwnerAndOrg();
        ddbMock.on(GetCommand, { Key: { PK: `ORG#${ORG_UUID}`, SK: `AGENT#nonexistent` } }).resolves({});

        const res = await lambdaHandler(
            buildEvent(OWNER_USER_ID, {
                httpMethod: 'PATCH',
                path: '/agents/by-id',
                queryStringParameters: { id: 'nonexistent' },
                body: JSON.stringify({ position: 'Lead Agent' }),
            }),
        );

        expect(res.statusCode).toBe(404);
    });

    it('returns 403 when the caller is not an owner/admin', async () => {
        ddbMock
            .on(GetCommand, { Key: { PK: `ORG#${ORG_UUID}`, SK: `USER#${STAFF_USER_ID}` } })
            .resolves({ Item: { data: JSON.stringify(staffMembership) } });

        const res = await lambdaHandler(
            buildEvent(STAFF_USER_ID, {
                httpMethod: 'PATCH',
                path: '/agents/by-id',
                queryStringParameters: { id: AGENT_ID },
                body: JSON.stringify({ position: 'Lead Agent' }),
            }),
        );

        expect(res.statusCode).toBe(403);
    });

    it('returns 422 when the organisation is not real-estate', async () => {
        mockOwnerAndOrg(nonRealEstateOrg);

        const res = await lambdaHandler(
            buildEvent(OWNER_USER_ID, {
                httpMethod: 'PATCH',
                path: '/agents/by-id',
                queryStringParameters: { id: AGENT_ID },
                body: JSON.stringify({ position: 'Lead Agent' }),
            }),
        );

        expect(res.statusCode).toBe(422);
    });

    it('returns 400 when the request body fails validation', async () => {
        const res = await lambdaHandler(
            buildEvent(OWNER_USER_ID, {
                httpMethod: 'PATCH',
                path: '/agents/by-id',
                queryStringParameters: { id: AGENT_ID },
                body: JSON.stringify({}),
            }),
        );

        expect(res.statusCode).toBe(400);
    });
});

describe('DELETE /agents/by-id', () => {
    it('returns 200 and deletes the agent', async () => {
        mockOwnerAndOrg();
        ddbMock
            .on(GetCommand, { Key: { PK: `ORG#${ORG_UUID}`, SK: `AGENT#${AGENT_ID}` } })
            .resolves({ Item: { data: JSON.stringify(sampleAgent) } });
        ddbMock.on(DeleteCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent(OWNER_USER_ID, {
                httpMethod: 'DELETE',
                path: '/agents/by-id',
                queryStringParameters: { id: AGENT_ID },
            }),
        );

        expect(res.statusCode).toBe(200);
        expect(ddbMock).toHaveReceivedCommandWith(DeleteCommand, {
            Key: { PK: `ORG#${ORG_UUID}`, SK: `AGENT#${AGENT_ID}` },
        });
    });

    it('returns 404 when the agent does not exist', async () => {
        mockOwnerAndOrg();
        ddbMock.on(GetCommand, { Key: { PK: `ORG#${ORG_UUID}`, SK: `AGENT#nonexistent` } }).resolves({});

        const res = await lambdaHandler(
            buildEvent(OWNER_USER_ID, {
                httpMethod: 'DELETE',
                path: '/agents/by-id',
                queryStringParameters: { id: 'nonexistent' },
            }),
        );

        expect(res.statusCode).toBe(404);
    });
});

describe('POST /agents/link', () => {
    it('returns 200 and links the agent to a team member', async () => {
        mockOwnerAndOrg();
        ddbMock
            .on(GetCommand, { Key: { PK: `ORG#${ORG_UUID}`, SK: `AGENT#${AGENT_ID}` } })
            .resolves({ Item: { data: JSON.stringify(sampleAgent) } });
        ddbMock
            .on(GetCommand, { Key: { PK: `ORG#${ORG_UUID}`, SK: `USER#${TARGET_USER_ID}` } })
            .resolves({ Item: { data: JSON.stringify(targetMembership) } });
        ddbMock.on(QueryCommand).resolves({ Items: [] });
        ddbMock.on(UpdateCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent(OWNER_USER_ID, {
                httpMethod: 'POST',
                path: '/agents/link',
                body: JSON.stringify({ agent_id: AGENT_ID, user_id: TARGET_USER_ID }),
            }),
        );

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).linked_user_id).toBe(TARGET_USER_ID);
    });

    it('returns 200 and unlinks when user_id is null', async () => {
        mockOwnerAndOrg();
        ddbMock
            .on(GetCommand, { Key: { PK: `ORG#${ORG_UUID}`, SK: `AGENT#${AGENT_ID}` } })
            .resolves({ Item: { data: JSON.stringify({ ...sampleAgent, linked_user_id: TARGET_USER_ID }) } });
        ddbMock.on(UpdateCommand).resolves({});

        const res = await lambdaHandler(
            buildEvent(OWNER_USER_ID, {
                httpMethod: 'POST',
                path: '/agents/link',
                body: JSON.stringify({ agent_id: AGENT_ID, user_id: null }),
            }),
        );

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).linked_user_id).toBeNull();
    });

    it('returns 404 when the agent does not exist', async () => {
        mockOwnerAndOrg();
        ddbMock.on(GetCommand, { Key: { PK: `ORG#${ORG_UUID}`, SK: `AGENT#nonexistent` } }).resolves({});

        const res = await lambdaHandler(
            buildEvent(OWNER_USER_ID, {
                httpMethod: 'POST',
                path: '/agents/link',
                body: JSON.stringify({ agent_id: 'nonexistent', user_id: TARGET_USER_ID }),
            }),
        );

        expect(res.statusCode).toBe(404);
    });

    it('returns 404 when user_id is not an actual member of the organisation', async () => {
        mockOwnerAndOrg();
        ddbMock
            .on(GetCommand, { Key: { PK: `ORG#${ORG_UUID}`, SK: `AGENT#${AGENT_ID}` } })
            .resolves({ Item: { data: JSON.stringify(sampleAgent) } });
        ddbMock.on(GetCommand, { Key: { PK: `ORG#${ORG_UUID}`, SK: `USER#not-a-member` } }).resolves({});

        const res = await lambdaHandler(
            buildEvent(OWNER_USER_ID, {
                httpMethod: 'POST',
                path: '/agents/link',
                body: JSON.stringify({ agent_id: AGENT_ID, user_id: 'not-a-member' }),
            }),
        );

        expect(res.statusCode).toBe(404);
    });

    it('returns 409 when user_id is already linked to a different agent', async () => {
        mockOwnerAndOrg();
        ddbMock
            .on(GetCommand, { Key: { PK: `ORG#${ORG_UUID}`, SK: `AGENT#${AGENT_ID}` } })
            .resolves({ Item: { data: JSON.stringify(sampleAgent) } });
        ddbMock
            .on(GetCommand, { Key: { PK: `ORG#${ORG_UUID}`, SK: `USER#${TARGET_USER_ID}` } })
            .resolves({ Item: { data: JSON.stringify(targetMembership) } });
        ddbMock.on(QueryCommand).resolves({
            Items: [{ data: JSON.stringify({ ...sampleAgent, id: 'other-agent', linked_user_id: TARGET_USER_ID }) }],
        });

        const res = await lambdaHandler(
            buildEvent(OWNER_USER_ID, {
                httpMethod: 'POST',
                path: '/agents/link',
                body: JSON.stringify({ agent_id: AGENT_ID, user_id: TARGET_USER_ID }),
            }),
        );

        expect(res.statusCode).toBe(409);
    });

    it('returns 403 when the caller is not an owner/admin', async () => {
        ddbMock
            .on(GetCommand, { Key: { PK: `ORG#${ORG_UUID}`, SK: `USER#${STAFF_USER_ID}` } })
            .resolves({ Item: { data: JSON.stringify(staffMembership) } });

        const res = await lambdaHandler(
            buildEvent(STAFF_USER_ID, {
                httpMethod: 'POST',
                path: '/agents/link',
                body: JSON.stringify({ agent_id: AGENT_ID, user_id: TARGET_USER_ID }),
            }),
        );

        expect(res.statusCode).toBe(403);
    });

    it('returns 422 when the organisation is not real-estate', async () => {
        mockOwnerAndOrg(nonRealEstateOrg);

        const res = await lambdaHandler(
            buildEvent(OWNER_USER_ID, {
                httpMethod: 'POST',
                path: '/agents/link',
                body: JSON.stringify({ agent_id: AGENT_ID, user_id: TARGET_USER_ID }),
            }),
        );

        expect(res.statusCode).toBe(422);
    });

    it('returns 400 when the request body fails validation', async () => {
        const res = await lambdaHandler(
            buildEvent(OWNER_USER_ID, {
                httpMethod: 'POST',
                path: '/agents/link',
                body: JSON.stringify({ agent_id: AGENT_ID }),
            }),
        );

        expect(res.statusCode).toBe(400);
    });

    it('returns 401 when unauthenticated', async () => {
        const res = await lambdaHandler(
            buildEvent(OWNER_USER_ID, {
                httpMethod: 'POST',
                path: '/agents/link',
                headers: { origin: ALLOWED_ORIGIN },
                body: JSON.stringify({ agent_id: AGENT_ID, user_id: TARGET_USER_ID }),
            }),
        );

        expect(res.statusCode).toBe(401);
    });
});
