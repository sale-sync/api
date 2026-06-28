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
import { ListContentsDTO } from '../dtos/media.dto';
import { ItemNotFoundError, AccessDeniedError } from '../errors/media.errors';

export default class DefaultController extends Controller implements IControllerMethods {
    private mediaService!: MediaService;
    private folderService!: FolderService;

    constructor(mediaService: MediaService, folderService: FolderService) {
        super('default');
        this.mediaService = mediaService;
        this.folderService = folderService;
    }

    /**
     * GET /media - List folder contents
     *
     * Query params:
     * - folder_id (optional, default: 'root')
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
            const dto = new ListContentsDTO();
            const params = dto.validate(event.queryStringParameters || {});

            const { folder_id } = params;
            const organisation_id = organisation.uuid;

            // Ensure root folder exists
            // ⚠️ TODO: Move this to organisation creation flow in the future.
            // This currently runs a GetCommand on every GET request to check if root
            // exists, which is unnecessary after the organisation is fully set up.
            // Root folder should be created once during organisation provisioning instead.
            // Ensure root folder exists
            await this.folderService.ensureRootFolder(organisation_id, user.id);

            // Get the folder
            const folder = await this.folderService.getFolderById(organisation_id, folder_id);
            if (!folder) {
                throw new ItemNotFoundError('folder', folder_id);
            }

            // Get breadcrumbs
            const breadcrumbs = await this.folderService.getBreadcrumbs(organisation_id, folder_id);

            // List folders in this folder
            const folders = await this.folderService.listFoldersInParent(organisation_id, folder_id);

            // List media in this folder
            const media = await this.mediaService.listMediaInFolder(organisation_id, folder_id);

            return {
                statusCode: 200,
                body: JSON.stringify({
                    folder: {
                        id: folder.id,
                        name: folder.name,
                        path: folder.path,
                        parent_id: folder.parent_id,
                        level: folder.level,
                        created_at: folder.created_at,
                        created_by: folder.created_by,
                    },
                    breadcrumbs,
                    folders: folders.map((f) => ({
                        id: f.id,
                        name: f.name,
                        path: f.path,
                        level: f.level,
                        item_count: f.item_count,
                        subfolder_count: f.subfolder_count, // ← new
                        created_at: f.created_at,
                    })),
                    media: media.map((m) => ({
                        id: m.id,
                        name: m.name,
                        mime_type: m.mime_type,
                        size: m.size,
                        url: m.s3_key,
                        thumbnail_url: m.thumbnail_url,
                        status: m.status,
                        created_at: m.created_at,
                        created_by: m.created_by,
                    })),
                }),
            };
        } catch (error) {
            return this.handleError(error);
        }
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
