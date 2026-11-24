import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { ConditionalCheckFailedException, DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { createDynamoStore } from '../../store/dynamo-store';
import { AlreadyAppliedError, SlugTakenError } from '../../services/errors';

// Pins the DynamoDB layout and the rules the table enforces (one application per user, unique link addresses, consistent reads).
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-southeast-2' }));
const ddb = mockClient(doc);
const TABLE = 'test-affiliate';
const store = createDynamoStore(TABLE, doc);
const conditional = () => new ConditionalCheckFailedException({ message: 'The conditional request failed', $metadata: {} });

beforeEach(() => ddb.reset());

describe('dynamo store', () => {
    it('reads the profile with a consistent read', async () => {
        ddb.on(GetCommand).resolves({ Item: { PK: 'AFF#u1', SK: 'PROFILE', kind: 'affiliate', userId: 'u1', market: 'thailand', stage: 'pending' } });
        const a = await store.getAffiliate('u1');
        expect(a).toEqual({ userId: 'u1', market: 'thailand', stage: 'pending' });
        expect(ddb).toHaveReceivedCommandWith(GetCommand, { TableName: TABLE, Key: { PK: 'AFF#u1', SK: 'PROFILE' }, ConsistentRead: true });
    });

    it('a user with no profile who is not a sample has no affiliate (nothing written)', async () => {
        ddb.on(GetCommand).resolves({});
        expect(await store.getAffiliate('someone-new')).toBeNull();
        expect(ddb).not.toHaveReceivedCommand(PutCommand);
    });

    it('writes a sample affiliate the first time it is requested', async () => {
        ddb.on(GetCommand).resolves({});
        ddb.on(PutCommand).resolves({});
        ddb.on(BatchWriteCommand).resolves({});
        const a = await store.getAffiliate('mock-affiliate-jordan');
        expect(a?.first).toBe('Jordan');
        expect(ddb).toHaveReceivedCommandWith(PutCommand, { ConditionExpression: 'attribute_not_exists(PK)' });
        const items = ddb.commandCalls(BatchWriteCommand).flatMap((c) => c.args[0].input.RequestItems![TABLE].map((r) => r.PutRequest!.Item!));
        expect(items.filter((i) => String(i.SK).startsWith('LINK#'))).toHaveLength(4);
        expect(items.filter((i) => String(i.PK).startsWith('SLUG#'))).toHaveLength(4);
        expect(items.filter((i) => String(i.SK).startsWith('REF#'))).toHaveLength(9);
        expect(items.find((i) => i.SK === 'PAYOUT')?.method).toMatchObject({ kind: 'bank', last4: '4821' });
    });

    it('does not seed twice when another request already did', async () => {
        ddb.on(GetCommand).resolves({});
        ddb.on(PutCommand).rejects(conditional());
        expect((await store.getAffiliate('mock-affiliate-ploy'))?.first).toBe('Ploy');
        expect(ddb).not.toHaveReceivedCommand(BatchWriteCommand);
    });

    it('refuses a second application with a conditional write', async () => {
        ddb.on(PutCommand).rejects(conditional());
        await expect(store.createAffiliate({ userId: 'u1' } as never)).rejects.toBeInstanceOf(AlreadyAppliedError);
    });

    it('reserves the link address and the link in one transaction', async () => {
        ddb.on(TransactWriteCommand).resolves({});
        const link = await store.addLink({ userId: 'u1', channel: 'tiktok', name: 'TikTok', slug: 'u1-tiktok', clicks: 0, createdOn: '2026-11-24' });
        const items = ddb.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems!;
        expect(items[0].Put).toMatchObject({ Item: { PK: 'SLUG#u1-tiktok', SK: 'SLUG', userId: 'u1', linkId: link.id }, ConditionExpression: 'attribute_not_exists(PK)' });
        expect(items[1].Put?.Item).toMatchObject({ PK: 'AFF#u1', SK: `LINK#${link.id}`, slug: 'u1-tiktok' });
    });

    it('maps a taken address to SlugTakenError', async () => {
        ddb.on(TransactWriteCommand).rejects(new TransactionCanceledException({ message: 'cancelled', $metadata: {}, CancellationReasons: [{ Code: 'ConditionalCheckFailed' }, { Code: 'None' }] }));
        await expect(store.addLink({ userId: 'u1', channel: 'tiktok', name: 'x', slug: 'taken', clicks: 0, createdOn: '' })).rejects.toBeInstanceOf(SlugTakenError);
    });

    it('lists links with a consistent query and every page', async () => {
        ddb.on(QueryCommand)
            .resolvesOnce({ Items: [{ PK: 'AFF#u1', SK: 'LINK#a', kind: 'link', id: 'a' }], LastEvaluatedKey: { PK: 'AFF#u1', SK: 'LINK#a' } })
            .resolvesOnce({ Items: [{ PK: 'AFF#u1', SK: 'LINK#b', kind: 'link', id: 'b' }] });
        expect(await store.listLinks('u1')).toEqual([{ id: 'a' }, { id: 'b' }]);
        expect(ddb).toHaveReceivedCommandWith(QueryCommand, { ConsistentRead: true, ExpressionAttributeValues: { ':pk': 'AFF#u1', ':sk': 'LINK#' } });
    });

    it('stores the payout method and reads it back, none by default', async () => {
        ddb.on(GetCommand).resolves({});
        expect(await store.getPayoutMethod('u1')).toEqual({ kind: 'none' });
        ddb.on(PutCommand).resolves({});
        await store.putPayoutMethod('u1', { kind: 'stripe' });
        expect(ddb).toHaveReceivedCommandWith(PutCommand, { Item: { PK: 'AFF#u1', SK: 'PAYOUT', kind: 'payout', method: { kind: 'stripe' } } });
    });
});

describe('store selection', () => {
    it('fails loudly without a table name (never writes somewhere else)', async () => {
        jest.resetModules();
        const saved = { ...process.env };
        delete process.env.AFFILIATE_STORE;
        delete process.env.AFFILIATE_TABLE_NAME;
        const { store: s } = await import('../../store');
        expect(() => s.getAffiliate).toThrow('AFFILIATE_TABLE_NAME environment variable is not set');
        process.env = saved;
    });
});
