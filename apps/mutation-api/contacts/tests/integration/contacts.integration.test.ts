import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { ContactFormRecord, ContactSubmission, Organisation } from '@sale-sync/shared/src/types';
import { lambdaHandler } from '../../app';

// Pins the two things that matter most on a public, unauthenticated write endpoint:
//   1. every read and write is keyed by the organisation in the Bearer token, so one organisation's
//      form and submissions never mix with another's;
//   2. a submission is validated against the form as stored, never against what the client sent.
const ddbMock = mockClient(DynamoDBClient);

const TABLE = 'test-organisation';
const ORG_A = 'org-uuid-a';
const ORG_B = 'org-uuid-b';

function fakeJwt(payload: Record<string, unknown>): string {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${header}.${body}.fake-signature`;
}

function buildEvent(orgUuid: string | null, overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
    const headers: Record<string, string> = { origin: 'https://client-site.example.com' };
    if (orgUuid) {
        headers.authorization = `Bearer ${fakeJwt({ organisation_id: 'some-org', user_id: '', uuid: orgUuid })}`;
    }
    return {
        httpMethod: 'GET',
        path: '/contacts',
        headers,
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

function post(orgUuid: string | null, body: unknown): APIGatewayProxyEvent {
    return buildEvent(orgUuid, { httpMethod: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
}

function org(uuid: string, market: 'TH' | 'AU'): Organisation {
    return {
        uuid,
        id: `id-${uuid}`,
        name: `Org ${uuid}`,
        status: 'ready',
        image: null,
        business_category: 'real-estate',
        template_id: '11111111-1111-4111-8111-111111111111',
        plan_id: '22222222-2222-4222-8222-222222222222',
        created_at: '2026-01-01T00:00:00.000Z',
        address: null,
        market,
    };
}

function mockOrg(organisation: Organisation): void {
    ddbMock
        .on(GetCommand, { TableName: TABLE, Key: { PK: 'ORG', SK: `META#${organisation.uuid}` } })
        .resolves({ Item: { data: JSON.stringify(organisation) } });
}

function mockForm(orgUuid: string, record: ContactFormRecord): void {
    ddbMock
        .on(GetCommand, { TableName: TABLE, Key: { PK: `ORG#${orgUuid}`, SK: 'CONTACT_FORM' } })
        .resolves({ Item: { data: JSON.stringify(record) } });
}

const customForm: ContactFormRecord = {
    updated_at: '2026-10-14T00:00:00.000Z',
    fields: [
        { id: 'fullName', type: 'text', inputType: 'string', label: 'Full name', required: true },
        { id: 'budget', type: 'text', inputType: 'number', label: 'Budget', required: false },
        { id: 'mail', type: 'email', label: 'Email', required: true },
        { id: 'tel', type: 'phone', label: 'Phone', required: false },
        { id: 'topic', type: 'select', label: 'Topic', required: true, options: ['Buy', 'Rent'] },
        { id: 'note', type: 'textarea', label: 'Note', required: false },
    ],
};

const validDefault = {
    name: 'Somchai',
    email: 'somchai@example.com',
    mobile: '081 234 5678',
    subject: 'General',
    description: 'Please call me back.',
};

beforeEach(() => {
    ddbMock.reset();
    // Anything not explicitly mocked (another org's keys, say) reads as "no such item".
    ddbMock.on(GetCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});
    process.env.ORGANISATION_TABLE_NAME = TABLE;
});

describe('GET /contacts', () => {
    it('returns the default five-field form, with the dial code of the org market, when the org has not saved one', async () => {
        mockOrg(org(ORG_A, 'AU'));

        const res = await lambdaHandler(buildEvent(ORG_A));

        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.dialCode).toBe('+61');
        expect(body.country).toBe('AU');
        expect(body.currency).toBe('AUD');
        expect(body.fields.map((field: { id: string; type: string }) => [field.id, field.type])).toEqual([
            ['name', 'text'],
            ['email', 'email'],
            ['mobile', 'phone'],
            ['subject', 'select'],
            ['description', 'textarea'],
        ]);
        expect(body.fields[3].options).toEqual(['General', 'Support', 'Feedback', 'Other']);
    });

    it("returns the org's own saved form, and never another org's", async () => {
        mockOrg(org(ORG_A, 'TH'));
        mockOrg(org(ORG_B, 'TH'));
        mockForm(ORG_A, customForm);

        const a = JSON.parse((await lambdaHandler(buildEvent(ORG_A))).body);
        const b = JSON.parse((await lambdaHandler(buildEvent(ORG_B))).body);

        expect(a.dialCode).toBe('+66');
        expect(a.currency).toBe('THB');
        expect(a.fields).toEqual(customForm.fields);
        // Org B has no saved form: it gets the default, not org A's.
        expect(b.fields.map((field: { id: string }) => field.id)).toEqual([
            'name',
            'email',
            'mobile',
            'subject',
            'description',
        ]);
    });

    it('404s without a Bearer token, and for an organisation that does not exist', async () => {
        expect((await lambdaHandler(buildEvent(null))).statusCode).toBe(404);
        expect((await lambdaHandler(buildEvent('no-such-org'))).statusCode).toBe(404);
    });

    it('answers the CORS preflight, allowing POST, and reflects the origin', async () => {
        const res = await lambdaHandler(buildEvent(null, { httpMethod: 'OPTIONS' }));

        expect(res.statusCode).toBe(204);
        expect(res.headers?.['Access-Control-Allow-Methods']).toBe('GET,POST,OPTIONS');
        expect(res.headers?.['Access-Control-Allow-Origin']).toBe('https://client-site.example.com');
    });
});

describe('POST /contacts', () => {
    it("stores the submission under the token's organisation, unread, with a label snapshot and the dial code", async () => {
        mockOrg(org(ORG_A, 'TH'));

        const res = await lambdaHandler(post(ORG_A, validDefault));

        expect(res.statusCode).toBe(201);
        const puts = ddbMock.commandCalls(PutCommand);
        expect(puts).toHaveLength(1);
        const input = puts[0].args[0].input;
        expect(input.TableName).toBe(TABLE);
        expect(input.Item?.PK).toBe(`ORG#${ORG_A}`);
        expect(input.Item?.SK).toMatch(/^CONTACT_SUBMISSION#\d{4}-\d{2}-\d{2}T/);
        expect(input.Item?.is_read).toBe(false);
        expect(input.Item?.search_text).toContain('somchai@example.com');
        expect(input.ConditionExpression).toBe('attribute_not_exists(PK)');

        const stored = JSON.parse(input.Item?.data) as ContactSubmission;
        expect(stored.org_uuid).toBe(ORG_A);
        expect(stored.read).toBe(false);
        expect(input.Item?.SK).toBe(`CONTACT_SUBMISSION#${stored.id}`);
        expect(stored.values).toEqual([
            { field_id: 'name', label: 'Name', type: 'text', value: 'Somchai' },
            { field_id: 'email', label: 'Email address', type: 'email', value: 'somchai@example.com' },
            { field_id: 'mobile', label: 'Mobile number', type: 'phone', value: '+66 081 234 5678' },
            { field_id: 'subject', label: 'Subject', type: 'select', value: 'General' },
            { field_id: 'description', label: 'Description', type: 'textarea', value: 'Please call me back.' },
        ]);

        // The response confirms the submit without echoing the stored record back.
        expect(Object.keys(JSON.parse(res.body)).sort()).toEqual(['id', 'submitted_at']);
    });

    it("validates against the submitting org's own form and writes only to that org", async () => {
        mockOrg(org(ORG_A, 'TH'));
        mockOrg(org(ORG_B, 'AU'));
        mockForm(ORG_A, customForm);

        // Valid for org A's custom form...
        const forA = { fullName: 'Ann', mail: 'ann@example.com', topic: 'Rent', budget: '25000.50' };
        expect((await lambdaHandler(post(ORG_A, forA))).statusCode).toBe(201);
        // ...but org B is on the default form, where those field ids do not exist.
        expect((await lambdaHandler(post(ORG_B, forA))).statusCode).toBe(400);
        // And org B's valid default submission is stored under org B.
        expect((await lambdaHandler(post(ORG_B, validDefault))).statusCode).toBe(201);

        const keys = ddbMock.commandCalls(PutCommand).map((call) => call.args[0].input.Item?.PK);
        expect(keys).toEqual([`ORG#${ORG_A}`, `ORG#${ORG_B}`]);
    });

    it('ignores an organisation named in the body or query string: only the token counts', async () => {
        mockOrg(org(ORG_A, 'TH'));
        mockOrg(org(ORG_B, 'TH'));

        // Extra keys are rejected outright, so a body cannot smuggle an org in.
        const smuggled = await lambdaHandler(post(ORG_A, { ...validDefault, org_uuid: ORG_B }));
        expect(smuggled.statusCode).toBe(400);

        const res = await lambdaHandler({
            ...post(ORG_A, validDefault),
            queryStringParameters: { uuid: ORG_B, org_uuid: ORG_B },
        });
        expect(res.statusCode).toBe(201);
        expect(ddbMock.commandCalls(PutCommand)[0].args[0].input.Item?.PK).toBe(`ORG#${ORG_A}`);
    });

    it.each([
        ['a missing required field', { ...validDefault, name: undefined }],
        ['an empty required field', { ...validDefault, name: '   ' }],
        ['a malformed email', { ...validDefault, email: 'not-an-email' }],
        ['an option that is not offered', { ...validDefault, subject: 'Sales' }],
        ['a malformed phone number', { ...validDefault, mobile: 'call me' }],
        ['a field the form does not have', { ...validDefault, company: 'Acme' }],
        ['a non-string value', { ...validDefault, description: { $gt: '' } }],
        ['an over-long value', { ...validDefault, name: 'a'.repeat(201) }],
    ])('rejects %s with 400 and stores nothing', async (_label, body) => {
        mockOrg(org(ORG_A, 'TH'));

        const res = await lambdaHandler(post(ORG_A, body));

        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body).issues.length).toBeGreaterThan(0);
        expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
    });

    it("keeps the dial code the visitor picked, and only accepts real dial codes", async () => {
        mockOrg(org(ORG_A, 'TH'));

        expect((await lambdaHandler(post(ORG_A, { ...validDefault, mobile: '+95 9 123 456 789' }))).statusCode).toBe(201);
        const stored = JSON.parse(ddbMock.commandCalls(PutCommand)[0].args[0].input.Item?.data) as ContactSubmission;
        expect(stored.values[2].value).toBe('+95 9 123 456 789');

        for (const mobile of ['+999 0812345678', '+66', '+66 call me', '++66 0812345678']) {
            expect((await lambdaHandler(post(ORG_A, { ...validDefault, mobile }))).statusCode).toBe(400);
        }
        expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
    });

    it('stores a price as currency + grouped amount, from the fixed currency list only', async () => {
        mockOrg(org(ORG_A, 'TH'));
        mockForm(ORG_A, {
            updated_at: '2026-10-14T00:00:00.000Z',
            fields: [{ id: 'budget', type: 'price', label: 'Budget', required: true }],
        });

        for (const [budget, stored] of [
            ['THB 3500000', 'THB 3,500,000'],
            ['USD 1,250.5', 'USD 1,250.5'],
            ['MMK 0', 'MMK 0'],
        ]) {
            ddbMock.resetHistory();
            expect((await lambdaHandler(post(ORG_A, { budget }))).statusCode).toBe(201);
            const record = JSON.parse(ddbMock.commandCalls(PutCommand)[0].args[0].input.Item?.data) as ContactSubmission;
            expect(record.values[0]).toEqual({ field_id: 'budget', label: 'Budget', type: 'price', value: stored });
        }

        ddbMock.resetHistory();
        for (const budget of ['JPY 1000', 'THB', '3500000', 'THB -5', 'THB 1.234', 'thb 100', 'THB 1'.padEnd(25, '0')]) {
            expect((await lambdaHandler(post(ORG_A, { budget }))).statusCode).toBe(400);
        }
        expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
    });

    it('enforces number-only text fields and lets optional fields be empty or omitted', async () => {
        mockOrg(org(ORG_A, 'TH'));
        mockForm(ORG_A, customForm);
        const base = { fullName: 'Ann', mail: 'ann@example.com', topic: 'Buy' };

        expect((await lambdaHandler(post(ORG_A, { ...base, budget: 'lots' }))).statusCode).toBe(400);
        expect((await lambdaHandler(post(ORG_A, { ...base, budget: '', tel: '', note: '' }))).statusCode).toBe(201);
        expect((await lambdaHandler(post(ORG_A, base))).statusCode).toBe(201);

        // Unanswered optional fields are still stored (as ''), so the Inbox shows the whole form.
        const stored = JSON.parse(ddbMock.commandCalls(PutCommand)[1].args[0].input.Item?.data) as ContactSubmission;
        expect(stored.values.map((entry) => entry.value)).toEqual(['Ann', '', 'ann@example.com', '', 'Buy', '']);
    });

    it('rejects a body that is not JSON, and one that is too large, before touching the table', async () => {
        mockOrg(org(ORG_A, 'TH'));

        expect((await lambdaHandler(post(ORG_A, '{not json'))).statusCode).toBe(400);

        const tooLarge = await lambdaHandler(post(ORG_A, { ...validDefault, description: 'a'.repeat(40 * 1024) }));
        expect(tooLarge.statusCode).toBe(413);
        expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
    });

    it('404s without a Bearer token, and for an organisation that does not exist, storing nothing', async () => {
        expect((await lambdaHandler(post(null, validDefault))).statusCode).toBe(404);
        expect((await lambdaHandler(post('no-such-org', validDefault))).statusCode).toBe(404);
        expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
    });

    it('fails loudly (500) instead of falling back to a default table when the table name is not configured', async () => {
        delete process.env.ORGANISATION_TABLE_NAME;

        const res = await lambdaHandler(post(ORG_A, validDefault));

        expect(res.statusCode).toBe(500);
        expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
    });
});
