import { Service, IService } from '@devyethiha/samjs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand, QueryCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import {
    FolderAlreadyExistsError,
    MaxDepthExceededError,
    MoveDepthExceededError,
    CircularMoveError,
    ItemNotFoundError,
    CannotModifyRootError,
} from '../errors/media.errors';

const MAX_FOLDER_DEPTH = 7; // Including root (levels 0-6)

export interface Folder {
    id: string;
    workspace_id: string;
    parent_id: string | null;
    name: string;
    path: string;
    level: number;
    item_count?: number;
    created_at: string;
    created_by: string;
}

export interface Breadcrumb {
    id: string;
    name: string;
}

export interface CreateFolderParams {
    workspace_id: string;
    parent_id: string;
    name: string;
    user_id: string;
}

export class FolderService extends Service implements IService {
    private DB_Client: DynamoDBClient;
    private tableName: string;

    constructor(DB_Client: DynamoDBClient) {
        super('folder');
        this.DB_Client = DB_Client;
        this.tableName = process.env.MEDIA_TABLE_NAME || 'sales-sync-media';
    }

    /**
     * Ensure root folder exists for workspace, create if not
     */
    async ensureRootFolder(workspaceId: string, userId: string): Promise<Folder> {
        const existing = await this.getFolderById(workspaceId, 'root');
        if (existing) {
            return existing;
        }

        const rootFolder: Folder = {
            id: 'root',
            workspace_id: workspaceId,
            parent_id: null,
            name: 'Root',
            path: '/',
            level: 0,
            created_at: new Date().toISOString(),
            created_by: userId,
        };

        await this.DB_Client.send(
            new PutCommand({
                TableName: this.tableName,
                Item: {
                    pk: `WS#${workspaceId}`,
                    sk: 'FOLDER#root',
                    ...rootFolder,
                    GSI1PK: `FOLDER#${workspaceId}#root`,
                    GSI1SK: 'FOLDER#Root',
                },
                ConditionExpression: 'attribute_not_exists(pk)',
            }),
        );

        return rootFolder;
    }

    /**
     * Get folder by ID
     */
    async getFolderById(workspaceId: string, folderId: string): Promise<Folder | null> {
        const result = await this.DB_Client.send(
            new GetCommand({
                TableName: this.tableName,
                Key: {
                    pk: `WS#${workspaceId}`,
                    sk: `FOLDER#${folderId}`,
                },
            }),
        );

        if (!result.Item) {
            return null;
        }

        return this.mapToFolder(result.Item);
    }

    /**
     * Create a new folder
     */
    async createFolder(params: CreateFolderParams): Promise<Folder> {
        const { workspace_id, parent_id, name, user_id } = params;

        // Get parent folder
        const parentFolder = await this.getFolderById(workspace_id, parent_id);
        if (!parentFolder) {
            throw new ItemNotFoundError('folder', parent_id);
        }

        // Check max depth
        if (parentFolder.level >= MAX_FOLDER_DEPTH - 1) {
            throw new MaxDepthExceededError();
        }

        // Build path
        const path = parentFolder.path === '/' ? `/${name}` : `${parentFolder.path}/${name}`;

        const folderId = uuidv4();
        const now = new Date().toISOString();

        const folder: Folder = {
            id: folderId,
            workspace_id,
            parent_id,
            name,
            path,
            level: parentFolder.level + 1,
            created_at: now,
            created_by: user_id,
        };

        try {
            await this.DB_Client.send(
                new PutCommand({
                    TableName: this.tableName,
                    Item: {
                        pk: `WS#${workspace_id}`,
                        sk: `FOLDER#${folderId}`,
                        ...folder,
                        GSI1PK: `FOLDER#${workspace_id}#${parent_id}`,
                        GSI1SK: `FOLDER#${name}`,
                        GSI2PK: `PATH#${workspace_id}`,
                        GSI2SK: path,
                    },
                    // Prevent duplicate folder names in same parent
                    ConditionExpression: 'attribute_not_exists(pk)',
                }),
            );
        } catch (error: any) {
            if (error.name === 'ConditionalCheckFailedException') {
                throw new FolderAlreadyExistsError(name);
            }
            throw error;
        }

        return folder;
    }

    /**
     * List folders in a parent folder
     */
    async listFoldersInParent(workspaceId: string, parentId: string): Promise<Folder[]> {
        const result = await this.DB_Client.send(
            new QueryCommand({
                TableName: this.tableName,
                IndexName: 'folder-contents-index',
                KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
                ExpressionAttributeValues: {
                    ':pk': `FOLDER#${workspaceId}#${parentId}`,
                    ':sk': 'FOLDER#',
                },
            }),
        );

        return (result.Items || []).map(this.mapToFolder);
    }

    /**
     * Get breadcrumb trail for a folder
     */
    async getBreadcrumbs(workspaceId: string, folderId: string): Promise<Breadcrumb[]> {
        const breadcrumbs: Breadcrumb[] = [];
        let currentId: string | null = folderId;

        while (currentId) {
            const folder = await this.getFolderById(workspaceId, currentId);
            console.log({
                whileFolder: {
                    folder,
                    workspaceId,
                    currentId,
                },
            });
            if (!folder) break;

            breadcrumbs.unshift({ id: folder.id, name: folder.name });
            currentId = folder.parent_id;
        }

        return breadcrumbs;
    }

    /**
     * Move folder to new parent
     */
    async moveFolder(workspaceId: string, folderId: string, targetFolderId: string, userId: string): Promise<Folder> {
        if (folderId === 'root') {
            throw new CannotModifyRootError('move');
        }

        const folder = await this.getFolderById(workspaceId, folderId);
        if (!folder) {
            throw new ItemNotFoundError('folder', folderId);
        }

        const targetFolder = await this.getFolderById(workspaceId, targetFolderId);
        if (!targetFolder) {
            throw new ItemNotFoundError('folder', targetFolderId);
        }

        // Check for circular reference
        if (await this.isDescendant(workspaceId, targetFolderId, folderId)) {
            throw new CircularMoveError();
        }

        // Check depth after move
        const folderDepth = await this.getMaxDescendantDepth(workspaceId, folderId);
        const depthIncrease = targetFolder.level + 1 - folder.level;
        if (folderDepth + depthIncrease >= MAX_FOLDER_DEPTH) {
            throw new MoveDepthExceededError();
        }

        // Update folder and all descendants
        await this.updateFolderPath(workspaceId, folder, targetFolder, userId);

        return (await this.getFolderById(workspaceId, folderId))!;
    }

    /**
     * Rename a folder
     */
    async renameFolder(workspaceId: string, folderId: string, newName: string, userId: string): Promise<Folder> {
        if (folderId === 'root') {
            throw new CannotModifyRootError('rename');
        }

        const folder = await this.getFolderById(workspaceId, folderId);
        if (!folder) {
            throw new ItemNotFoundError('folder', folderId);
        }

        // Build new path
        const parentPath = folder.path.substring(0, folder.path.lastIndexOf('/'));
        const newPath = parentPath === '' ? `/${newName}` : `${parentPath}/${newName}`;

        // Update folder
        await this.DB_Client.send(
            new PutCommand({
                TableName: this.tableName,
                Item: {
                    pk: `WS#${workspaceId}`,
                    sk: `FOLDER#${folderId}`,
                    ...folder,
                    name: newName,
                    path: newPath,
                    GSI1PK: `FOLDER#${workspaceId}#${folder.parent_id}`,
                    GSI1SK: `FOLDER#${newName}`,
                    GSI2PK: `PATH#${workspaceId}`,
                    GSI2SK: newPath,
                },
            }),
        );

        // Update all descendant paths
        await this.updateDescendantPaths(workspaceId, folder.path, newPath);

        return (await this.getFolderById(workspaceId, folderId))!;
    }

    /**
     * Delete folder and all contents (cascade)
     */
    async deleteFolder(workspaceId: string, folderId: string): Promise<{ folders: number; media: number }> {
        if (folderId === 'root') {
            throw new CannotModifyRootError('delete');
        }

        const folder = await this.getFolderById(workspaceId, folderId);
        if (!folder) {
            throw new ItemNotFoundError('folder', folderId);
        }

        // Get all descendants using path prefix
        const descendants = await this.getDescendants(workspaceId, folder.path);

        // Separate folders and media
        const folderItems = descendants.filter((item) => item.sk.startsWith('FOLDER#'));
        const mediaItems = descendants.filter((item) => item.sk.startsWith('MEDIA#'));

        // Batch delete all items (including the folder itself)
        const allItems = [
            { pk: `WS#${workspaceId}`, sk: `FOLDER#${folderId}` },
            ...descendants.map((item) => ({ pk: item.pk, sk: item.sk })),
        ];

        // DynamoDB BatchWriteItem limit is 25
        const batches = this.chunkArray(allItems, 25);
        for (const batch of batches) {
            await this.DB_Client.send(
                new BatchWriteCommand({
                    RequestItems: {
                        [this.tableName]: batch.map((item) => ({
                            DeleteRequest: { Key: item },
                        })),
                    },
                }),
            );
        }

        return {
            folders: folderItems.length,
            media: mediaItems.length,
        };
    }

    /**
     * Check if a folder is a descendant of another
     */
    private async isDescendant(
        workspaceId: string,
        potentialDescendantId: string,
        ancestorId: string,
    ): Promise<boolean> {
        if (potentialDescendantId === ancestorId) {
            return true;
        }

        let currentId: string | null = potentialDescendantId;
        while (currentId && currentId !== 'root') {
            const folder = await this.getFolderById(workspaceId, currentId);
            if (!folder) return false;
            if (folder.parent_id === ancestorId) return true;
            currentId = folder.parent_id;
        }

        return false;
    }

    /**
     * Get maximum depth of descendants
     */
    private async getMaxDescendantDepth(workspaceId: string, folderId: string): Promise<number> {
        const folder = await this.getFolderById(workspaceId, folderId);
        if (!folder) return 0;

        const descendants = await this.getDescendants(workspaceId, folder.path);
        const folderDescendants = descendants.filter((item) => item.sk.startsWith('FOLDER#'));

        let maxLevel = folder.level;
        for (const desc of folderDescendants) {
            if (desc.level > maxLevel) {
                maxLevel = desc.level;
            }
        }

        return maxLevel;
    }

    /**
     * Get all descendants of a folder by path prefix
     */
    private async getDescendants(workspaceId: string, folderPath: string): Promise<any[]> {
        const pathPrefix = folderPath === '/' ? '/' : `${folderPath}/`;

        const result = await this.DB_Client.send(
            new QueryCommand({
                TableName: this.tableName,
                IndexName: 'path-index',
                KeyConditionExpression: 'GSI2PK = :pk AND begins_with(GSI2SK, :path)',
                ExpressionAttributeValues: {
                    ':pk': `PATH#${workspaceId}`,
                    ':path': pathPrefix,
                },
            }),
        );

        return result.Items || [];
    }

    /**
     * Update folder path after move
     */
    private async updateFolderPath(
        workspaceId: string,
        folder: Folder,
        targetFolder: Folder,
        userId: string,
    ): Promise<void> {
        const oldPath = folder.path;
        const newPath = targetFolder.path === '/' ? `/${folder.name}` : `${targetFolder.path}/${folder.name}`;
        const levelDiff = targetFolder.level + 1 - folder.level;

        // Update the folder itself
        await this.DB_Client.send(
            new PutCommand({
                TableName: this.tableName,
                Item: {
                    pk: `WS#${workspaceId}`,
                    sk: `FOLDER#${folder.id}`,
                    ...folder,
                    parent_id: targetFolder.id,
                    path: newPath,
                    level: targetFolder.level + 1,
                    GSI1PK: `FOLDER#${workspaceId}#${targetFolder.id}`,
                    GSI1SK: `FOLDER#${folder.name}`,
                    GSI2PK: `PATH#${workspaceId}`,
                    GSI2SK: newPath,
                },
            }),
        );

        // Update all descendants
        await this.updateDescendantPaths(workspaceId, oldPath, newPath, levelDiff);
    }

    /**
     * Update paths of all descendants after rename/move
     */
    private async updateDescendantPaths(
        workspaceId: string,
        oldPath: string,
        newPath: string,
        levelDiff = 0,
    ): Promise<void> {
        const descendants = await this.getDescendants(workspaceId, oldPath);

        for (const item of descendants) {
            const updatedPath = item.path.replace(oldPath, newPath);
            const updatedLevel = levelDiff !== 0 ? item.level + levelDiff : item.level;

            await this.DB_Client.send(
                new PutCommand({
                    TableName: this.tableName,
                    Item: {
                        ...item,
                        path: updatedPath,
                        level: updatedLevel,
                        GSI2SK: updatedPath,
                    },
                }),
            );
        }
    }

    /**
     * Map DynamoDB item to Folder interface
     */
    private mapToFolder(item: Record<string, any>): Folder {
        return {
            id: item.id,
            workspace_id: item.workspace_id,
            parent_id: item.parent_id,
            name: item.name,
            path: item.path,
            level: item.level,
            item_count: item.item_count,
            created_at: item.created_at,
            created_by: item.created_by,
        };
    }

    /**
     * Chunk array into smaller arrays
     */
    private chunkArray<T>(array: T[], size: number): T[][] {
        const chunks: T[][] = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }
}
