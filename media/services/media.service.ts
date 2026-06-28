import { Service, IService } from '@devyethiha/samjs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand, QueryCommand, DeleteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { FolderItemLimitExceededError, ItemNotFoundError } from '../errors/media.errors';
import { Folder } from './folder.service';
import { MAX_ITEMS_IN_FOLDER, PENDING_UPLOAD_TTL_SECONDS } from './media.constants';

export interface Media {
    id: string;
    organisation_id: string;
    folder_id: string;
    name: string;
    path: string;
    mime_type: string;
    s3_key: string;
    thumbnail_url?: string;
    size?: number | null;
    metadata?: {
        width?: number;
        height?: number;
        duration?: number;
    };
    status: 'pending' | 'ready' | 'error';
    TTL?: number;
    created_at: string;
    created_by: string;
    updated_at?: string;
    updated_by?: string;
}

export interface CreateMediaParams {
    organisation_id: string;
    folder_id: string;
    file_name: string;
    mime_type: string;
    user_id: string;
}

export class MediaService extends Service implements IService {
    private DB_Client: DynamoDBClient;
    private tableName: string;

    constructor(DB_Client: DynamoDBClient) {
        super('media');
        this.DB_Client = DB_Client;
        this.tableName = process?.env.MEDIA_TABLE_NAME || 'sales-sync-media';
    }

    /**
     * Create a new media record (pending upload)
     */
    async createMedia(params: CreateMediaParams, folder: Folder): Promise<Media> {
        const { organisation_id, folder_id, file_name, mime_type, user_id } = params;

        // Check media limit
        this.checkMediaLimit(folder);

        const mediaId = uuidv4();
        const now = new Date().toISOString();
        const TTL = Math.floor(Date.now() / 1000) + PENDING_UPLOAD_TTL_SECONDS;
        const s3Key = `cdn/${organisation_id}/${mediaId}/${file_name}`;
        const path = folder.path === '/' ? `/${file_name}` : `${folder.path}/${file_name}`;

        const media: Media = {
            id: mediaId,
            organisation_id,
            folder_id,
            name: file_name,
            path,
            mime_type,
            s3_key: s3Key,
            status: 'pending',
            TTL,
            created_at: now,
            created_by: user_id,
        };

        await this.DB_Client.send(
            new PutCommand({
                TableName: this.tableName,
                Item: {
                    PK: `WS#${organisation_id}#PENDING#MEDIA`, // ← pending partition
                    SK: `MEDIA#${mediaId}`,
                    GSI1PK: `FOLDER#${organisation_id}#${folder_id}`,
                    GSI1SK: `PENDING#MEDIA#${file_name}`,
                    GSI2PK: `PATH#${organisation_id}`,
                    GSI2SK: path,
                    TTL, // ← top level for DynamoDB TTL
                    data: media, // ← data wrapper
                },
            }),
        );

        return media;
    }

    /**
     * Get media by ID
     */
    async getMediaById(organisationId: string, mediaId: string): Promise<Media | null> {
        const result = await this.DB_Client.send(
            new GetCommand({
                TableName: this.tableName,
                Key: {
                    PK: `WS#${organisationId}#MEDIA`, // ← ready partition only
                    SK: `MEDIA#${mediaId}`,
                },
            }),
        );

        if (!result.Item) {
            return null;
        }

        return this.mapToMedia(result.Item);
    }

    /**
     * List media in a folder
     */
    async listMediaInFolder(organisationId: string, folderId: string): Promise<Media[]> {
        const result = await this.DB_Client.send(
            new QueryCommand({
                TableName: this.tableName,
                IndexName: 'folder-contents-index',
                KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
                ExpressionAttributeValues: {
                    ':pk': `FOLDER#${organisationId}#${folderId}`,
                    ':sk': 'MEDIA#',
                },
            }),
        );

        return (result.Items || []).map(this.mapToMedia);
    }

    /**
     * Move media to a different folder
     */
    async moveMedia(organisationId: string, mediaId: string, targetFolder: Folder, userId: string): Promise<Media> {
        const media = await this.getMediaById(organisationId, mediaId);
        if (!media) {
            throw new ItemNotFoundError('media', mediaId);
        }

        // Check media limit on target folder
        this.checkMediaLimit(targetFolder);

        const newPath = targetFolder.path === '/' ? `/${media.name}` : `${targetFolder.path}/${media.name}`;
        const now = new Date().toISOString();

        // PK + SK are unchanged on move — PutCommand fully replaces the item in place,
        // including all GSI keys (GSI1PK updates to new folder, GSI2SK updates to new path).
        // No separate DeleteCommand needed.
        await this.DB_Client.send(
            new PutCommand({
                TableName: this.tableName,
                Item: {
                    PK: `WS#${organisationId}#MEDIA`,
                    SK: `MEDIA#${mediaId}`,
                    GSI1PK: `FOLDER#${organisationId}#${targetFolder.id}`,
                    GSI1SK: `MEDIA#${media.name}`,
                    GSI2PK: `PATH#${organisationId}`,
                    GSI2SK: newPath,
                    data: {
                        ...media,
                        folder_id: targetFolder.id,
                        path: newPath,
                        updated_at: now,
                        updated_by: userId,
                    },
                },
            }),
        );

        // Update item counts
        await this.updateCount(organisationId, media.folder_id, -1); // ← old folder
        await this.updateCount(organisationId, targetFolder.id, 1); // ← new folder

        const moved = await this.getMediaById(organisationId, mediaId);
        if (!moved) {
            throw new ItemNotFoundError('media', mediaId);
        }

        return moved;
    }

    /**
     * Rename media
     */
    async renameMedia(organisationId: string, mediaId: string, newName: string, userId: string): Promise<Media> {
        const media = await this.getMediaById(organisationId, mediaId);
        if (!media) {
            throw new ItemNotFoundError('media', mediaId);
        }

        const parentPath = media.path.substring(0, media.path.lastIndexOf('/'));
        const newPath = parentPath === '' ? `/${newName}` : `${parentPath}/${newName}`;
        const now = new Date().toISOString();

        await this.DB_Client.send(
            new PutCommand({
                TableName: this.tableName,
                Item: {
                    PK: `WS#${organisationId}#MEDIA`,
                    SK: `MEDIA#${mediaId}`,
                    GSI1PK: `FOLDER#${organisationId}#${media.folder_id}`,
                    GSI1SK: `MEDIA#${newName}`,
                    GSI2PK: `PATH#${organisationId}`,
                    GSI2SK: newPath,
                    data: {
                        ...media,
                        name: newName,
                        path: newPath,
                        updated_at: now,
                        updated_by: userId,
                    },
                },
            }),
        );

        const renamed = await this.getMediaById(organisationId, mediaId);
        if (!renamed) {
            throw new ItemNotFoundError('media', mediaId);
        }

        return renamed;
    }

    /**
     * Delete media
     */
    async deleteMedia(organisationId: string, mediaId: string): Promise<Media> {
        const media = await this.getMediaById(organisationId, mediaId);
        if (!media) {
            throw new ItemNotFoundError('media', mediaId);
        }

        await this.DB_Client.send(
            new DeleteCommand({
                TableName: this.tableName,
                Key: {
                    PK: `WS#${organisationId}#MEDIA`,
                    SK: `MEDIA#${mediaId}`,
                },
            }),
        );

        // Decrement folder item count
        await this.updateCount(organisationId, media.folder_id, -1);

        return media;
    }

    /**
     * Map DynamoDB item to Media interface
     */
    private mapToMedia(item: Record<string, any>): Media {
        const data = item.data;
        return {
            id: data.id,
            organisation_id: data.organisation_id,
            folder_id: data.folder_id,
            name: data.name,
            path: data.path,
            mime_type: data.mime_type,
            s3_key: data.s3_key,
            thumbnail_url: data.thumbnail_url,
            size: data.size,
            metadata: data.metadata,
            status: data.status,
            TTL: data.TTL,
            created_at: data.created_at,
            created_by: data.created_by,
            updated_at: data.updated_at,
            updated_by: data.updated_by,
        };
    }

    // ⚠️ WARNING: Negative count guard
    // item_count should never go below 0 in normal flow since we only
    // decrement after confirmed deletes. If data inconsistency occurs
    // (e.g. failed writes, manual DB edits), this could produce negative
    // counts. Add a ConditionExpression guard if stricter consistency needed:
    //
    // ConditionExpression: 'if_not_exists(#data.#field, :zero) + :delta >= :zero'
    //
    // ⚠️ WARNING: Not fully atomic
    // SET + if_not_exists is used instead of ADD because ADD does not support
    // nested attributes (fields inside 'data'). Safe for sequential calls but
    // has a small race condition window for concurrent updates to the same folder.
    // Move item_count to top-level attribute to enable true atomic ADD if needed.
    private async updateCount(organisationId: string, folderId: string, delta: 1 | -1): Promise<void> {
        await this.DB_Client.send(
            new UpdateCommand({
                TableName: this.tableName,
                Key: {
                    PK: `WS#${organisationId}#FOLDER`,
                    SK: `FOLDER#${folderId}`,
                },
                UpdateExpression: 'SET #data.#field = if_not_exists(#data.#field, :zero) + :delta',
                ExpressionAttributeNames: {
                    '#data': 'data',
                    '#field': 'item_count',
                },
                ExpressionAttributeValues: {
                    ':delta': delta,
                    ':zero': 0,
                },
            }),
        );
    }

    private checkMediaLimit(folder: Folder): void {
        if ((folder.item_count ?? 0) >= MAX_ITEMS_IN_FOLDER) {
            throw new FolderItemLimitExceededError();
        }
    }
}
