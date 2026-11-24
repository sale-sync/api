import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { IService, Service } from '@devyethiha/samjs';
import { findAffiliate } from '../shared/affiliate';
import { LinkNotFoundError } from '../shared/errors';
import type { Market } from '../shared/rules';
import { addClick, findSlug } from './click.repository';

/** An affiliate link opened: which programme it belongs to (for the redirect), and the click counted when asked. */
export class ClickService extends Service implements IService {
    constructor(DB_Client: DynamoDBClient, db: DynamoDBDocumentClient) {
        super('click');
        void DB_Client;
        void db;
    }

    async follow(slug: string, count: boolean): Promise<{ market: Market }> {
        const owner = await findSlug(slug);
        if (!owner) throw new LinkNotFoundError();
        const a = await findAffiliate(owner.userId);
        if (!a || a.stage !== 'approved') throw new LinkNotFoundError(); // links exist only for approved affiliates
        if (count) {
            try {
                await addClick(owner);
            } catch (e) {
                if (e instanceof ConditionalCheckFailedException) throw new LinkNotFoundError(); // reservation without its link
                throw e;
            }
        }
        return { market: a.market };
    }
}
