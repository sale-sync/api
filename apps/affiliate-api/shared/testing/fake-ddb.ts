// An in-memory DynamoDB document client for the unit tests: just the commands and conditions the affiliate repositories use
// (Get, Put with attribute_(not_)exists(PK), Query with PK = :pk AND begins_with(SK, :sk), BatchWrite puts, TransactWrite puts).
// The repositories run their real code against it, so the tests cover the same code path as DynamoDB.
import { ConditionalCheckFailedException, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';

type Item = Record<string, unknown>;

export class FakeDdb {
    items = new Map<string, Item>();
    readonly key = (pk: unknown, sk: unknown) => `${pk}|${sk}`;

    private check(cond: string | undefined, it: Item) {
        if (!cond) return true;
        const exists = this.items.has(this.key(it.PK, it.SK));
        if (cond === 'attribute_not_exists(PK)') return !exists;
        if (cond === 'attribute_exists(PK)') return exists;
        throw new Error(`FakeDdb: unsupported condition ${cond}`);
    }

    async send(command: unknown): Promise<unknown> {
        const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
        if (command instanceof GetCommand) {
            const { PK, SK } = command.input.Key as Item;
            const it = this.items.get(this.key(PK, SK));
            return { Item: it ? clone(it) : undefined };
        }
        if (command instanceof PutCommand) {
            const it = command.input.Item as Item;
            if (!this.check(command.input.ConditionExpression, it)) throw new ConditionalCheckFailedException({ message: 'The conditional request failed', $metadata: {} });
            this.items.set(this.key(it.PK, it.SK), clone(it));
            return {};
        }
        if (command instanceof QueryCommand) {
            const v = command.input.ExpressionAttributeValues as Item;
            const rows = [...this.items.values()].filter((i) => i.PK === v[':pk'] && String(i.SK).startsWith(String(v[':sk'])));
            return { Items: rows.sort((a, b) => String(a.SK).localeCompare(String(b.SK))).map(clone) };
        }
        if (command instanceof BatchWriteCommand) {
            for (const reqs of Object.values(command.input.RequestItems ?? {})) for (const r of reqs) if (r.PutRequest?.Item) this.items.set(this.key(r.PutRequest.Item.PK, r.PutRequest.Item.SK), clone(r.PutRequest.Item));
            return {};
        }
        if (command instanceof TransactWriteCommand) {
            const puts = (command.input.TransactItems ?? []).map((t) => t.Put!);
            const reasons = puts.map((p) => ({ Code: this.check(p.ConditionExpression, p.Item as Item) ? 'None' : 'ConditionalCheckFailed' }));
            if (reasons.some((r) => r.Code !== 'None')) throw new TransactionCanceledException({ message: 'Transaction cancelled', $metadata: {}, CancellationReasons: reasons });
            for (const p of puts) this.items.set(this.key((p.Item as Item).PK, (p.Item as Item).SK), clone(p.Item as Item));
            return {};
        }
        throw new Error(`FakeDdb: unsupported command ${(command as { constructor: { name: string } }).constructor.name}`);
    }
}

/** A fresh fake, installed as the client every repository uses. */
export function useFakeDdb(setDocClient: (c: DynamoDBDocumentClient | null) => void): FakeDdb {
    const fake = new FakeDdb();
    setDocClient(fake as unknown as DynamoDBDocumentClient);
    return fake;
}
