import { Service, IService } from '@devyethiha/samjs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    DynamoDBDocumentClient,
    QueryCommand,
    GetCommand,
    PutCommand,
    UpdateCommand,
    DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { Block, validateBlock, validateBlocks, ValidationResult, BatchValidationResult } from '../types/blocks.types';
import { CreateBlockDto, UpdateBlockDto, ValidateBlockDto, ValidateBatchDto } from './blocks.dto';

export class BlocksService extends Service implements IService {
    private docClient: DynamoDBDocumentClient;

    constructor(DB_Client: DynamoDBClient) {
        super('blocks');
        this.docClient = DynamoDBDocumentClient.from(DB_Client, {
            marshallOptions: { removeUndefinedValues: true },
        });
    }

    // ─── Fetch ────────────────────────────────

    async findAll(organisationId: string): Promise<Block[]> {
        const result = await this.docClient.send(
            new QueryCommand({
                TableName: process.env.BLOCK_TABLE_NAME,
                KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk_prefix)',
                ExpressionAttributeValues: {
                    ':pk': `ORGANISATION#${organisationId}#BLOCK`,
                    ':sk_prefix': 'BLOCK#',
                },
            }),
        );
        return (result.Items ?? []).map((item) => item.data as Block);
    }

    async findById(organisationId: string, id: string): Promise<Block | undefined> {
        const result = await this.docClient.send(
            new GetCommand({
                TableName: process.env.BLOCK_TABLE_NAME,
                Key: {
                    pk: `ORGANISATION#${organisationId}#BLOCK`,
                    sk: `BLOCK#${id}`,
                },
            }),
        );
        return result.Item?.data as Block | undefined;
    }

    // ─── Validate stored block ─────────────────

    async validateById(organisationId: string, id: string): Promise<{ id: string } & ValidationResult> {
        const block = await this.findById(organisationId, id);
        if (!block) {
            throw Object.assign(new Error('Block not found'), { statusCode: 404 });
        }
        const result = validateBlock(block.data, block.meta_object);
        return { id, ...result };
    }

    // ─── Mutate ───────────────────────────────

    async create(organisationId: string, payload: CreateBlockDto): Promise<Block> {
        const id = randomUUID();
        const now = new Date().toISOString();

        const block: Block = {
            id,
            title: payload.title,
            data: payload.data,
            draft: payload.draft ?? null,
            meta_object: payload.meta_object,
        };

        const validation = validateBlock(block.data, block.meta_object);
        if (!validation.valid) {
            throw Object.assign(new Error('Validation failed'), {
                statusCode: 422,
                errors: validation.errors,
            });
        }

        await this.docClient.send(
            new PutCommand({
                TableName: process.env.BLOCK_TABLE_NAME,
                Item: {
                    pk: `ORGANISATION#${organisationId}#BLOCK`,
                    sk: `BLOCK#${id}`,
                    data: block,
                    created_at: now,
                    updated_at: now,
                },
            }),
        );

        return block;
    }

    async update(organisationId: string, id: string, payload: UpdateBlockDto): Promise<Block> {
        const existing = await this.findById(organisationId, id);
        if (!existing) {
            throw Object.assign(new Error('Block not found'), { statusCode: 404 });
        }

        const updated: Block = { ...existing, ...payload, id };

        const validation = validateBlock(updated.data, updated.meta_object);
        if (!validation.valid) {
            throw Object.assign(new Error('Validation failed'), {
                statusCode: 422,
                errors: validation.errors,
            });
        }

        await this.docClient.send(
            new UpdateCommand({
                TableName: process.env.BLOCK_TABLE_NAME,
                Key: {
                    pk: `ORGANISATION#${organisationId}#BLOCK`,
                    sk: `BLOCK#${id}`,
                },
                UpdateExpression: 'SET #data = :data, updated_at = :updated_at',
                ExpressionAttributeNames: { '#data': 'data' },
                ExpressionAttributeValues: {
                    ':data': updated,
                    ':updated_at': new Date().toISOString(),
                },
            }),
        );

        return updated;
    }

    async delete(organisationId: string, id: string): Promise<void> {
        const existing = await this.findById(organisationId, id);
        if (!existing) {
            throw Object.assign(new Error('Block not found'), { statusCode: 404 });
        }
        await this.docClient.send(
            new DeleteCommand({
                TableName: process.env.BLOCK_TABLE_NAME,
                Key: {
                    pk: `ORGANISATION#${organisationId}#BLOCK`,
                    sk: `BLOCK#${id}`,
                },
            }),
        );
    }

    // ─── Dry-run validation ───────────────────

    validateOne(block: ValidateBlockDto): ValidationResult {
        return validateBlock(block.data, block.meta_object);
    }

    validateMany(blocks: ValidateBatchDto): BatchValidationResult {
        return validateBlocks(blocks as unknown as Block[]);
    }
}
