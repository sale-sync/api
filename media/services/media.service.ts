import { Service, IService } from '@devyethiha/samjs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { ItemNotFoundError, MoveDepthExceededError } from '../errors/media.errors';
import { FolderService, Folder } from './folder.service';

export interface Media {
    id: string;
    workspace_id: string;
    folder_id: string;
    name: string;
    path: string;
    mime_type: string;
    size: number;
    s3_key: string;
    thumbnail_url?: string;
    metadata?: {
        width?: number;
        height?: number;
        duration?: number;
    };
    status: 'pending' | 'ready' | 'error';
    created_at: string;
    created_by: string;
    updated_at?: string;
}

export interface CreateMediaParams {
    workspace_id: string;
    folder_id: string;
    file_name: string;
    mime_type: string;
    size: number;
    user_id: string;
}

export class MediaService extends Service implements IService {
    private DB_Client: DynamoDBClient;
    private tableName: string;
    private bucketName: string;

    constructor(DB_Client: DynamoDBClient) {
        super('media');
        this.DB_Client = DB_Client;
        this.tableName = process?.env.MEDIA_TABLE_NAME || 'sales-sync-media';
        this.bucketName = process?.env.S3_BUCKET_NAME || 'sales-sync-media-bucket';
    }

    /**
     * Create a new media record (pending upload)
     */
    async createMedia(params: CreateMediaParams, folderPath: string): Promise<Media> {
        const { workspace_id, folder_id, file_name, mime_type, size, user_id } = params;

        const mediaId = uuidv4();
        const now = new Date().toISOString();
        const s3Key = `cdn/${workspace_id}/${mediaId}/${file_name}`;
        const path = folderPath === '/' ? `/${file_name}` : `${folderPath}/${file_name}`;

        const media: Media = {
            id: mediaId,
            workspace_id,
            folder_id,
            name: file_name,
            path,
            mime_type,
            size,
            s3_key: s3Key,
            status: 'pending',
            created_at: now,
            created_by: user_id,
        };

        await this.DB_Client.send(
            new PutCommand({
                TableName: this.tableName,
                Item: {
                    pk: `WS#${workspace_id}`,
                    sk: `MEDIA#${mediaId}`,
                    ...media,
                    GSI1PK: `FOLDER#${workspace_id}#${folder_id}`,
                    GSI1SK: `MEDIA#${file_name}`,
                    GSI2PK: `PATH#${workspace_id}`,
                    GSI2SK: path,
                },
            }),
        );

        return media;
    }

    /**
     * Get media by ID
     */
    async getMediaById(workspaceId: string, mediaId: string): Promise<Media | null> {
        const result = await this.DB_Client.send(
            new GetCommand({
                TableName: this.tableName,
                Key: {
                    pk: `WS#${workspaceId}`,
                    sk: `MEDIA#${mediaId}`,
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
    async listMediaInFolder(workspaceId: string, folderId: string): Promise<Media[]> {
        const result = await this.DB_Client.send(
            new QueryCommand({
                TableName: this.tableName,
                IndexName: 'folder-contents-index',
                KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
                ExpressionAttributeValues: {
                    ':pk': `FOLDER#${workspaceId}#${folderId}`,
                    ':sk': 'MEDIA#',
                },
            }),
        );

        return (result.Items || []).map(this.mapToMedia);
    }

    /**
     * Update media status after upload completes
     */
    async updateMediaStatus(
        workspaceId: string,
        mediaId: string,
        status: 'ready' | 'error',
        metadata?: Media['metadata'],
    ): Promise<Media> {
        const media = await this.getMediaById(workspaceId, mediaId);
        if (!media) {
            throw new ItemNotFoundError('media', mediaId);
        }

        const now = new Date().toISOString();

        await this.DB_Client.send(
            new PutCommand({
                TableName: this.tableName,
                Item: {
                    pk: `WS#${workspaceId}`,
                    sk: `MEDIA#${mediaId}`,
                    ...media,
                    status,
                    metadata: metadata || media.metadata,
                    updated_at: now,
                    GSI1PK: `FOLDER#${workspaceId}#${media.folder_id}`,
                    GSI1SK: `MEDIA#${media.name}`,
                    GSI2PK: `PATH#${workspaceId}`,
                    GSI2SK: media.path,
                },
            }),
        );

        return (await this.getMediaById(workspaceId, mediaId))!;
    }

    /**
     * Move media to a different folder
     */
    async moveMedia(workspaceId: string, mediaId: string, targetFolder: Folder): Promise<Media> {
        const media = await this.getMediaById(workspaceId, mediaId);
        if (!media) {
            throw new ItemNotFoundError('media', mediaId);
        }

        const newPath = targetFolder.path === '/' ? `/${media.name}` : `${targetFolder.path}/${media.name}`;

        const now = new Date().toISOString();

        await this.DB_Client.send(
            new PutCommand({
                TableName: this.tableName,
                Item: {
                    pk: `WS#${workspaceId}`,
                    sk: `MEDIA#${mediaId}`,
                    ...media,
                    folder_id: targetFolder.id,
                    path: newPath,
                    updated_at: now,
                    GSI1PK: `FOLDER#${workspaceId}#${targetFolder.id}`,
                    GSI1SK: `MEDIA#${media.name}`,
                    GSI2PK: `PATH#${workspaceId}`,
                    GSI2SK: newPath,
                },
            }),
        );

        return (await this.getMediaById(workspaceId, mediaId))!;
    }

    /**
     * Rename media
     */
    async renameMedia(workspaceId: string, mediaId: string, newName: string): Promise<Media> {
        const media = await this.getMediaById(workspaceId, mediaId);
        if (!media) {
            throw new ItemNotFoundError('media', mediaId);
        }

        // Build new path
        const parentPath = media.path.substring(0, media.path.lastIndexOf('/'));
        const newPath = parentPath === '' ? `/${newName}` : `${parentPath}/${newName}`;

        const now = new Date().toISOString();

        await this.DB_Client.send(
            new PutCommand({
                TableName: this.tableName,
                Item: {
                    pk: `WS#${workspaceId}`,
                    sk: `MEDIA#${mediaId}`,
                    ...media,
                    name: newName,
                    path: newPath,
                    updated_at: now,
                    GSI1PK: `FOLDER#${workspaceId}#${media.folder_id}`,
                    GSI1SK: `MEDIA#${newName}`,
                    GSI2PK: `PATH#${workspaceId}`,
                    GSI2SK: newPath,
                },
            }),
        );

        return (await this.getMediaById(workspaceId, mediaId))!;
    }

    /**
     * Delete media
     */
    async deleteMedia(workspaceId: string, mediaId: string): Promise<Media> {
        const media = await this.getMediaById(workspaceId, mediaId);
        if (!media) {
            throw new ItemNotFoundError('media', mediaId);
        }

        await this.DB_Client.send(
            new DeleteCommand({
                TableName: this.tableName,
                Key: {
                    pk: `WS#${workspaceId}`,
                    sk: `MEDIA#${mediaId}`,
                },
            }),
        );

        return media;
    }

    /**
     * Get S3 key for media
     */
    getS3Key(media: Media): string {
        return media.s3_key;
    }

    /**
     * Map DynamoDB item to Media interface
     */
    private mapToMedia(item: Record<string, any>): Media {
        return {
            id: item.id,
            workspace_id: item.workspace_id,
            folder_id: item.folder_id,
            name: item.name,
            path: item.path,
            mime_type: item.mime_type,
            size: item.size,
            s3_key: `/${item.s3_key}`,
            thumbnail_url: item.thumbnail_url,
            metadata: item.metadata,
            status: item.status,
            created_at: item.created_at,
            created_by: item.created_by,
            updated_at: item.updated_at,
        };
    }
}
