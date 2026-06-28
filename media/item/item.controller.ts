import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
    Controller,
    IControllerMethods,
    isAuthorize,
    getUser,
    UNAUTHORIZE_ERROR,
    NO_USER,
    ValidationError,
} from '@devyethiha/samjs';
import { getOrganisation, NO_ORGANISATION } from '@sales-sync/shared';
import { MediaService } from '../services/media.service';
import { FolderService } from '../services/folder.service';
import { S3Service } from '../services/s3.service';
import { MoveItemDTO, RenameItemDTO, DeleteItemDTO, GetItemDTO } from '../dtos/media.dto';
import {
    ItemNotFoundError,
    AccessDeniedError,
    CannotModifyRootError,
    CircularMoveError,
    MoveDepthExceededError,
} from '../errors/media.errors';

export default class ItemController extends Controller implements IControllerMethods {
    private mediaService!: MediaService;
    private folderService!: FolderService;
    private s3Service!: S3Service;

    constructor(mediaService: MediaService, folderService: FolderService, s3Service: S3Service) {
        super('items');
        this.mediaService = mediaService;
        this.folderService = folderService;
        this.s3Service = s3Service;
    }

    /**
     * GET /media?item_id=uuid - Get media details
     * GET /media/{item_id}/download - Get download URL
     *
     * Organisation context from Organisation cookie JWT
     */
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) {
            return UNAUTHORIZE_ERROR;
        }

        const user = getUser(event);
        if (!user) {
            return NO_USER;
        }

        const organisation = getOrganisation(event);
        if (!organisation) {
            return NO_ORGANISATION;
        }

        try {
            const organisation_id = organisation.uuid;

            // Extract item_id from path
            const dto = new GetItemDTO ()
            const queryParams = dto.validate(event.queryStringParameters || {});
            const { item_id } = queryParams;
            if (!item_id) {
                return {
                    statusCode: 400,
                    body: JSON.stringify({ message: 'Missing item_id in path' }),
                };
            }

            // Check if this is a download request
            const isDownload = event.path.endsWith('/download');

            const media = await this.mediaService.getMediaById(organisation_id, item_id);
            if (!media) {
                throw new ItemNotFoundError('media', item_id);
            }

            if (isDownload) {
                // Generate download URL
                const downloadResult = await this.s3Service.generateDownloadUrl(
                    media.s3_key,
                    media.name,
                    media.mime_type,
                    media.size,
                );

                return {
                    statusCode: 200,
                    body: JSON.stringify(downloadResult),
                };
            }

            // Return media details
            return {
                statusCode: 200,
                body: JSON.stringify({
                    id: media.id,
                    name: media.name,
                    path: media.path,
                    folder_id: media.folder_id,
                    mime_type: media.mime_type,
                    size: media.size,
                    s3_key: media.s3_key,
                    thumbnail_url: media.thumbnail_url,
                    metadata: media.metadata,
                    status: media.status,
                    created_at: media.created_at,
                    created_by: media.created_by,
                    updated_at: media.updated_at,
                }),
            };
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * PATCH /media/{item_id}/move - Move item to different folder
     * PATCH /media/{item_id}/rename - Rename item
     *
     * Organisation context from Organisation cookie JWT
     */
    async patch(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) {
            return UNAUTHORIZE_ERROR;
        }

        const user = getUser(event);
        if (!user) {
            return NO_USER;
        }

        const organisation = getOrganisation(event);
        if (!organisation) {
            return NO_ORGANISATION;
        }

        try {
            const itemId = this.extractItemId(event.path);
            if (!itemId) {
                return {
                    statusCode: 400,
                    body: JSON.stringify({ message: 'Missing item_id in path' }),
                };
            }

            const isMove = event.path.includes('/move');
            const isRename = event.path.includes('/rename');

            if (isMove) {
                return await this.handleMove(event, itemId, organisation.uuid, user.id);
            } else if (isRename) {
                return await this.handleRename(event, itemId, organisation.uuid, user.id);
            }

            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'Invalid PATCH operation' }),
            };
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * DELETE /media/items?item_id=uuid&item_type=media|folder
     *
     * Organisation context from Organisation cookie JWT
     */
    async delete(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) {
            return UNAUTHORIZE_ERROR;
        }

        const user = getUser(event);
        if (!user) {
            return NO_USER;
        }

        const organisation = getOrganisation(event);
        if (!organisation) {
            return NO_ORGANISATION;
        }

        try {
            const dto = new DeleteItemDTO();
            const queryParams = dto.validate(event.queryStringParameters || {});
            const { item_type, item_id } = queryParams;
            const organisation_id = organisation.uuid;

            if (!item_id) {
                return {
                    statusCode: 400,
                    body: JSON.stringify({ message: 'Missing item_id in path' }),
                };
            }

            const now = new Date().toISOString();

            if (item_type === 'folder') {
                const result = await this.folderService.deleteFolder(organisation_id, item_id);

                // TODO: Delete S3 objects for all media in cascade
                // This should be done asynchronously via SQS/EventBridge

                return {
                    statusCode: 200,
                    body: JSON.stringify({
                        message: 'Folder and contents deleted successfully',
                        id: item_id,
                        deleted_items: result,
                        deleted_at: now,
                    }),
                };
            } else {
                const media = await this.mediaService.deleteMedia(organisation_id, item_id);

                // Delete S3 object
                await this.s3Service.deleteObject(media.s3_key);

                return {
                    statusCode: 200,
                    body: JSON.stringify({
                        message: 'Media deleted successfully',
                        id: item_id,
                        deleted_at: now,
                    }),
                };
            }
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Handle move operation
     */
    private async handleMove(
        event: APIGatewayProxyEvent,
        itemId: string,
        organisationId: string,
        userId: string,
    ): Promise<APIGatewayProxyResult> {
        const dto = new MoveItemDTO();
        const body = JSON.parse(event.body || '{}');
        const params = dto.validate(body);

        const { target_folder_id, item_type } = params;

        // Verify target folder exists
        const targetFolder = await this.folderService.getFolderById(organisationId, target_folder_id);
        if (!targetFolder) {
            throw new ItemNotFoundError('folder', target_folder_id);
        }

        const now = new Date().toISOString();

        if (item_type === 'folder') {
            const folder = await this.folderService.moveFolder(organisationId, itemId, target_folder_id, userId);

            return {
                statusCode: 200,
                body: JSON.stringify({
                    id: folder.id,
                    name: folder.name,
                    path: folder.path,
                    folder_id: folder.parent_id,
                    moved_at: now,
                }),
            };
        } else {
            const media = await this.mediaService.moveMedia(organisationId, itemId, targetFolder);

            return {
                statusCode: 200,
                body: JSON.stringify({
                    id: media.id,
                    name: media.name,
                    path: media.path,
                    folder_id: media.folder_id,
                    moved_at: now,
                }),
            };
        }
    }

    /**
     * Handle rename operation
     */
    private async handleRename(
        event: APIGatewayProxyEvent,
        itemId: string,
        organisationId: string,
        userId: string,
    ): Promise<APIGatewayProxyResult> {
        const dto = new RenameItemDTO();
        const body = JSON.parse(event.body || '{}');
        const params = dto.validate(body);

        const { name, item_type } = params;

        const now = new Date().toISOString();

        if (item_type === 'folder') {
            const folder = await this.folderService.renameFolder(organisationId, itemId, name, userId);

            return {
                statusCode: 200,
                body: JSON.stringify({
                    id: folder.id,
                    name: folder.name,
                    path: folder.path,
                    renamed_at: now,
                }),
            };
        } else {
            const media = await this.mediaService.renameMedia(organisationId, itemId, name);

            return {
                statusCode: 200,
                body: JSON.stringify({
                    id: media.id,
                    name: media.name,
                    path: media.path,
                    renamed_at: now,
                }),
            };
        }
    }

    /**
     * Extract item ID from path
     * Path format: /media/{item_id} or /media/{item_id}/move or /media/{item_id}/download
     */
    private extractItemId(path: string): string | null {
        const parts = path.split('/').filter(Boolean);
        // parts[0] = 'media', parts[1] = item_id, parts[2] = action (optional)
        if (parts.length >= 2 && parts[0] === 'media') {
            const itemId = parts[1];
            // Skip controller paths
            if (['upload', 'folders'].includes(itemId)) {
                return null;
            }
            return itemId;
        }
        return null;
    }

    /**
     * Handle errors and return appropriate response
     */
    private handleError(error: unknown): APIGatewayProxyResult {
        if (error instanceof ValidationError) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    message: 'Validation failed',
                    issues: error.issues,
                }),
            };
        }

        if (error instanceof CannotModifyRootError) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    message: error.message,
                }),
            };
        }

        if (error instanceof CircularMoveError || error instanceof MoveDepthExceededError) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    message: error.message,
                }),
            };
        }

        if (error instanceof ItemNotFoundError) {
            return {
                statusCode: 404,
                body: JSON.stringify({
                    message: error.message,
                }),
            };
        }

        if (error instanceof AccessDeniedError) {
            return {
                statusCode: 403,
                body: JSON.stringify({
                    message: error.message,
                }),
            };
        }

        console.error('Unexpected error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: 'Internal server error',
            }),
        };
    }
}
