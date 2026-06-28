import { Service, IService } from '@devyethiha/samjs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand, QueryCommand, BatchWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { MAX_FOLDER_DEPTH, MAX_SUBFOLDERS_IN_FOLDER } from './media.constants';
import {
    FolderAlreadyExistsError,
    MaxDepthExceededError,
    MoveDepthExceededError,
    CircularMoveError,
    ItemNotFoundError,
    CannotModifyRootError,
    SameNameError,
    SubfolderLimitExceededError,
} from '../errors/media.errors';

export interface Folder {
    id: string;
    organisation_id: string;
    parent_id: string | null;
    name: string;
    path: string;
    level: number;
    item_count?: number;
    subfolder_count?: number;
    created_at: string;
    created_by: string;
    updated_at?: string;
    updated_by?: string;
}

export interface Breadcrumb {
    id: string;
    name: string;
}

export interface CreateFolderParams {
    organisation_id: string;
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
     * Ensure root folder exists for organisation, create if not
     */
    async ensureRootFolder(organisationId: string, userId: string): Promise<Folder> {
        const existing = await this.getFolderById(organisationId, 'root');
        if (existing) {
            return existing;
        }

        const rootFolder: Folder = {
            id: 'root',
            organisation_id: organisationId,
            parent_id: null,
            name: 'Root',
            path: '/',
            level: 0,
            item_count: 0,
            subfolder_count: 0,
            created_at: new Date().toISOString(),
            created_by: userId,
        };

        console.log({ rootFolder });

        await this.DB_Client.send(
            new PutCommand({
                TableName: this.tableName,
                Item: {
                    PK: `WS#${organisationId}#FOLDER`,
                    SK: 'FOLDER#root',
                    GSI1PK: `FOLDER#${organisationId}#root`,
                    GSI1SK: 'FOLDER#Root',
                    data: rootFolder, // ← data wrapper
                },
                ConditionExpression: 'attribute_not_exists(PK)',
            }),
        );

        return rootFolder;
    }

    /**
     * Get folder by ID
     */
    async getFolderById(organisationId: string, folderId: string): Promise<Folder | null> {
        console.log({
            organisationId,
            folderId,
        });
        const result = await this.DB_Client.send(
            new GetCommand({
                TableName: this.tableName,
                Key: {
                    PK: `WS#${organisationId}#FOLDER`, // ← updated
                    SK: `FOLDER#${folderId}`,
                },
            }),
        );

        if (!result.Item) {
            return null;
        }

        return this.mapToFolder(result.Item);
    }

    /**
     * Check duplicate folder name in same parent
     */
    private async checkDuplicateName(organisationId: string, parentId: string, name: string): Promise<void> {
        const duplicateCheck = await this.DB_Client.send(
            new QueryCommand({
                TableName: this.tableName,
                IndexName: 'folder-name-index',
                KeyConditionExpression: 'GSI3PK = :pk AND GSI3SK = :sk',
                ExpressionAttributeValues: {
                    ':pk': `FOLDER#${organisationId}#${parentId}`,
                    ':sk': `NAME#${name}`,
                },
                Limit: 1,
            }),
        );

        if (duplicateCheck.Items && duplicateCheck.Items.length > 0) {
            throw new FolderAlreadyExistsError(name);
        }
    }

    /**
     * Search folders by name prefix within a parent
     */
    async searchFoldersByName(organisationId: string, parentId: string, prefix: string): Promise<Folder[]> {
        const result = await this.DB_Client.send(
            new QueryCommand({
                TableName: this.tableName,
                IndexName: 'folder-name-index',
                KeyConditionExpression: 'GSI3PK = :pk AND begins_with(GSI3SK, :prefix)',
                ExpressionAttributeValues: {
                    ':pk': `FOLDER#${organisationId}#${parentId}`,
                    ':prefix': `NAME#${prefix}`,
                },
            }),
        );

        return (result.Items || []).map(this.mapToFolder);
    }

    /**
     * Create a new folder
     */
    async createFolder(params: CreateFolderParams): Promise<Folder> {
        const { organisation_id, parent_id, name, user_id } = params;

        const parentFolder = await this.getFolderById(organisation_id, parent_id);
        if (!parentFolder) {
            throw new ItemNotFoundError('folder', parent_id);
        }

        if (parentFolder.level >= MAX_FOLDER_DEPTH - 1) {
            throw new MaxDepthExceededError();
        }

        // Check folder limits
        this.checkFolderLimits(parentFolder);

        await this.checkDuplicateName(organisation_id, parent_id, name);

        const path = parentFolder.path === '/' ? `/${name}` : `${parentFolder.path}/${name}`;
        const folderId = uuidv4();
        const now = new Date().toISOString();

        const folder: Folder = {
            id: folderId,
            organisation_id,
            parent_id,
            name,
            path,
            level: parentFolder.level + 1,
            item_count: 0,
            subfolder_count: 0,
            created_at: now,
            created_by: user_id,
        };

        await this.DB_Client.send(
            new PutCommand({
                TableName: this.tableName,
                Item: {
                    PK: `WS#${organisation_id}#FOLDER`,
                    SK: `FOLDER#${folderId}`,
                    GSI1PK: `FOLDER#${organisation_id}#${parent_id}`,
                    GSI1SK: `FOLDER#${name}`,
                    GSI2PK: `PATH#${organisation_id}`,
                    GSI2SK: path,
                    GSI3PK: `FOLDER#${organisation_id}#${parent_id}`,
                    GSI3SK: `NAME#${name}`,
                    data: folder, // ← data wrapper
                },
            }),
        );

        // Increment parent subfolder count
        await this.updateCount(organisation_id, parent_id, 'subfolder_count', 1);

        return folder;
    }

    /**
     * List folders in a parent folder
     */
    async listFoldersInParent(organisationId: string, parentId: string): Promise<Folder[]> {
        const result = await this.DB_Client.send(
            new QueryCommand({
                TableName: this.tableName,
                IndexName: 'folder-contents-index',
                KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
                ExpressionAttributeValues: {
                    ':pk': `FOLDER#${organisationId}#${parentId}`,
                    ':sk': 'FOLDER#',
                },
            }),
        );

        return (result.Items || []).map(this.mapToFolder);
    }

    /**
     * Get breadcrumb trail for a folder
     */
    async getBreadcrumbs(organisationId: string, folderId: string): Promise<Breadcrumb[]> {
        const breadcrumbs: Breadcrumb[] = [];
        let currentId: string | null = folderId;

        while (currentId) {
            const folder = await this.getFolderById(organisationId, currentId);

            if (!folder) break;

            breadcrumbs.unshift({ id: folder.id, name: folder.name });
            currentId = folder.parent_id;
        }

        return breadcrumbs;
    }

    /**
     * Move folder to new parent
     */
    async moveFolder(organisationId: string, folderId: string, targetFolderId: string, userId: string): Promise<Folder> {
        if (folderId === 'root') {
            throw new CannotModifyRootError('move');
        }

        const folder = await this.getFolderById(organisationId, folderId);
        if (!folder) {
            throw new ItemNotFoundError('folder', folderId);
        }

        const targetFolder = await this.getFolderById(organisationId, targetFolderId);
        if (!targetFolder) {
            throw new ItemNotFoundError('folder', targetFolderId);
        }

        // Check for circular reference
        if (await this.isDescendant(organisationId, targetFolderId, folderId)) {
            throw new CircularMoveError();
        }

        // Check depth after move
        const folderDepth = await this.getMaxDescendantDepth(organisationId, folderId);
        const depthIncrease = targetFolder.level + 1 - folder.level;
        if (folderDepth + depthIncrease >= MAX_FOLDER_DEPTH) {
            throw new MoveDepthExceededError();
        }

        // Check subfolder limit on target  ← new
        this.checkFolderLimits(targetFolder);

        // Update folder and all descendants
        await this.updateFolderPath(organisationId, folder, targetFolder, userId);

        return (await this.getFolderById(organisationId, folderId))!;
    }

    /**
     * Rename a folder
     */
    async renameFolder(organisationId: string, folderId: string, newName: string, userId: string): Promise<Folder> {
        if (folderId === 'root') {
            throw new CannotModifyRootError('rename');
        }

        const folder = await this.getFolderById(organisationId, folderId);
        if (!folder) {
            throw new ItemNotFoundError('folder', folderId);
        }

        if (folder.name === newName) {
            throw new SameNameError(newName);
        }

        await this.checkDuplicateName(organisationId, folder.parent_id!, newName);

        const parentPath = folder.path.substring(0, folder.path.lastIndexOf('/'));
        const newPath = parentPath === '' ? `/${newName}` : `${parentPath}/${newName}`;
        const now = new Date().toISOString();

        await this.DB_Client.send(
            new PutCommand({
                TableName: this.tableName,
                Item: {
                    PK: `WS#${organisationId}#FOLDER`,
                    SK: `FOLDER#${folderId}`,
                    GSI1PK: `FOLDER#${organisationId}#${folder.parent_id}`,
                    GSI1SK: `FOLDER#${newName}`,
                    GSI2PK: `PATH#${organisationId}`,
                    GSI2SK: newPath,
                    GSI3PK: `FOLDER#${organisationId}#${folder.parent_id}`,
                    GSI3SK: `NAME#${newName}`,
                    data: {
                        // ← data wrapper
                        ...folder,
                        name: newName,
                        path: newPath,
                        updated_at: now,
                        updated_by: userId,
                    },
                },
            }),
        );

        await this.updateDescendantPaths(organisationId, folder.path, newPath);

        return (await this.getFolderById(organisationId, folderId))!;
    }

    /**
     * Delete folder and all contents (cascade)
     */
    async deleteFolder(organisationId: string, folderId: string): Promise<{ folders: number; media: number }> {
        if (folderId === 'root') {
            throw new CannotModifyRootError('delete');
        }

        const folder = await this.getFolderById(organisationId, folderId);
        if (!folder) {
            throw new ItemNotFoundError('folder', folderId);
        }

        const descendants = await this.getDescendants(organisationId, folder.path);

        const folderItems = descendants.filter((item) => item.SK.startsWith('FOLDER#'));
        const mediaItems = descendants.filter((item) => item.SK.startsWith('MEDIA#'));

        const allItems = [
            { PK: `WS#${organisationId}#FOLDER`, SK: `FOLDER#${folderId}` },
            ...descendants.map((item) => ({ PK: item.PK, SK: item.SK })),
        ];

        const batches = this.chunkArray(allItems, 25);
        await Promise.all(
            batches.map((batch) =>
                this.DB_Client.send(
                    new BatchWriteCommand({
                        RequestItems: {
                            [this.tableName]: batch.map((item) => ({
                                DeleteRequest: { Key: item },
                            })),
                        },
                    }),
                ),
            ),
        );

        // Decrement parent subfolder count
        await this.updateCount(organisationId, folder.parent_id!, 'subfolder_count', -1);

        return {
            folders: folderItems.length,
            media: mediaItems.length,
        };
    }

    /**
     * Check if a folder is a descendant of another
     */
    private async isDescendant(
        organisationId: string,
        potentialDescendantId: string,
        ancestorId: string,
    ): Promise<boolean> {
        if (potentialDescendantId === ancestorId) {
            return true;
        }

        let currentId: string | null = potentialDescendantId;
        while (currentId && currentId !== 'root') {
            const folder = await this.getFolderById(organisationId, currentId);
            if (!folder) return false;
            if (folder.parent_id === ancestorId) return true;
            currentId = folder.parent_id;
        }

        return false;
    }

    /**
     * Get maximum depth of descendants
     */
    private async getMaxDescendantDepth(organisationId: string, folderId: string): Promise<number> {
        const folder = await this.getFolderById(organisationId, folderId);
        if (!folder) return 0;

        const descendants = await this.getDescendants(organisationId, folder.path);
        const folderDescendants = descendants.filter((item) => item.SK.startsWith('FOLDER#'));

        let maxLevel = folder.level;
        for (const desc of folderDescendants) {
            if (desc.data.level > maxLevel) {
                // ← read from data
                maxLevel = desc.data.level;
            }
        }

        return maxLevel;
    }

    /**
     * Get all descendants of a folder by path prefix
     */
    private async getDescendants(organisationId: string, folderPath: string): Promise<any[]> {
        const pathPrefix = folderPath === '/' ? '/' : `${folderPath}/`;

        const result = await this.DB_Client.send(
            new QueryCommand({
                TableName: this.tableName,
                IndexName: 'path-index',
                KeyConditionExpression: 'GSI2PK = :pk AND begins_with(GSI2SK, :path)',
                ExpressionAttributeValues: {
                    ':pk': `PATH#${organisationId}`,
                    ':path': pathPrefix,
                },
            }),
        );

        return result.Items || [];
    }

    /**
     * Update folder path after move (private helper)
     */
    private async updateFolderPath(
        organisationId: string,
        folder: Folder,
        targetFolder: Folder,
        userId: string,
    ): Promise<void> {
        const oldPath = folder.path;
        const newPath = targetFolder.path === '/' ? `/${folder.name}` : `${targetFolder.path}/${folder.name}`;
        const levelDiff = targetFolder.level + 1 - folder.level;
        const now = new Date().toISOString();

        await this.checkDuplicateName(organisationId, targetFolder.id, folder.name);

        await this.DB_Client.send(
            new PutCommand({
                TableName: this.tableName,
                Item: {
                    PK: `WS#${organisationId}#FOLDER`,
                    SK: `FOLDER#${folder.id}`,
                    GSI1PK: `FOLDER#${organisationId}#${targetFolder.id}`,
                    GSI1SK: `FOLDER#${folder.name}`,
                    GSI2PK: `PATH#${organisationId}`,
                    GSI2SK: newPath,
                    GSI3PK: `FOLDER#${organisationId}#${targetFolder.id}`,
                    GSI3SK: `NAME#${folder.name}`,
                    data: {
                        // ← data wrapper
                        ...folder,
                        parent_id: targetFolder.id,
                        path: newPath,
                        level: targetFolder.level + 1,
                        updated_at: now,
                        updated_by: userId,
                    },
                },
            }),
        );

        // Update subfolder counts
        await this.updateCount(organisationId, folder.parent_id!, 'subfolder_count', -1);
        await this.updateCount(organisationId, targetFolder.id, 'subfolder_count', 1);

        await this.updateDescendantPaths(organisationId, oldPath, newPath, levelDiff);
    }

    /**
     * Update paths of all descendants after rename/move
     */
    private async updateDescendantPaths(
        organisationId: string,
        oldPath: string,
        newPath: string,
        levelDiff = 0,
    ): Promise<void> {
        const descendants = await this.getDescendants(organisationId, oldPath);

        await Promise.all(
            descendants.map((item) => {
                const updatedPath = item.data.path.replace(oldPath, newPath); // ← read from data
                const updatedLevel =
                    levelDiff !== 0
                        ? item.data.level + levelDiff // ← read from data
                        : item.data.level;

                const PK = item.SK.startsWith('FOLDER#') ? `WS#${organisationId}#FOLDER` : `WS#${organisationId}#MEDIA`;

                return this.DB_Client.send(
                    new PutCommand({
                        TableName: this.tableName,
                        Item: {
                            ...item,
                            PK,
                            GSI2SK: updatedPath,
                            data: {
                                // ← update inside data wrapper
                                ...item.data,
                                path: updatedPath,
                                level: updatedLevel,
                            },
                        },
                    }),
                );
            }),
        );
    }

    /**
     * Update the item_count / subfolder_count of the folder
     */
    private async updateCount(
        organisationId: string,
        folderId: string,
        field: 'item_count' | 'subfolder_count',
        delta: 1 | -1,
    ): Promise<void> {
        // ⚠️ WARNING: Negative count guard
        // In normal flow, counts should never go below 0 since we initialize
        // both item_count and subfolder_count to 0 on folder creation and only
        // decrement after confirmed writes. However, if data inconsistency occurs
        // (e.g. failed writes, manual DB edits, race conditions), this operation
        // could produce negative counts. Consider adding a ConditionExpression
        // guard if stricter consistency is required:
        //
        // ConditionExpression: 'if_not_exists(#data.#field, :zero) + :delta >= :zero'
        //
        // Note: This would cause the update to throw ConditionalCheckFailedException
        // instead of silently writing a negative value, but adds an extra failure
        // mode to handle in callers.

        // ⚠️ WARNING: Not fully atomic
        // SET + if_not_exists is used instead of ADD because ADD does not support
        // nested attributes (fields inside 'data'). This approach is safe for
        // sequential calls but has a small race condition window for concurrent
        // updates to the same folder. For high-concurrency organisations, consider
        // moving item_count and subfolder_count to top-level attributes to
        // enable true atomic ADD operations.

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
                    '#field': field,
                },
                ExpressionAttributeValues: {
                    ':delta': delta,
                    ':zero': 0,
                },
            }),
        );
    }

    private checkFolderLimits(parentFolder: Folder): void {
        if ((parentFolder.subfolder_count ?? 0) >= MAX_SUBFOLDERS_IN_FOLDER) {
            throw new SubfolderLimitExceededError();
        }
    }

    /**
     * Map DynamoDB item to Folder interface
     */
    private mapToFolder(item: Record<string, any>): Folder {
        const data = item.data;
        return {
            id: data.id,
            organisation_id: data.organisation_id,
            parent_id: data.parent_id,
            name: data.name,
            path: data.path,
            level: data.level,
            item_count: data.item_count,
            subfolder_count: data.subfolder_count,
            created_at: data.created_at,
            created_by: data.created_by,
            updated_at: data.updated_at,
            updated_by: data.updated_by,
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
