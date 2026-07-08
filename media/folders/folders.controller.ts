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
import { getOrganisation, NO_ORGANISATION } from '@sale-sync/shared';
import { FolderService } from '../services/folder.service';
import { CreateFolderDTO } from '../dtos/media.dto';
import {
    ItemNotFoundError,
    AccessDeniedError,
    FolderAlreadyExistsError,
    MaxDepthExceededError,
} from '../errors/media.errors';

export default class FoldersController extends Controller implements IControllerMethods {
    private folderService!: FolderService;

    constructor(folderService: FolderService) {
        super('folders');
        this.folderService = folderService;
    }

    /**
     * POST /media/folders - Create a new folder
     *
     * Body:
     * - parent_id (optional, default: 'root')
     * - name (required)
     *
     * Organisation context from Organisation cookie JWT
     */
    async post(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
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
            const dto = new CreateFolderDTO();
            const body = JSON.parse(event.body || '{}');
            const params = dto.validate(body);

            const { parent_id, name } = params;
            const organisation_id = organisation.uuid;

            // Ensure root folder exists
            await this.folderService.ensureRootFolder(organisation_id, user.id);

            // Create the folder
            const folder = await this.folderService.createFolder({
                organisation_id,
                parent_id,
                name,
                user_id: user.id,
            });

            return {
                statusCode: 201,
                body: JSON.stringify({
                    id: folder.id,
                    name: folder.name,
                    path: folder.path,
                    parent_id: folder.parent_id,
                    level: folder.level,
                    created_at: folder.created_at,
                    created_by: folder.created_by,
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

        if (error instanceof MaxDepthExceededError) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    message: error.message,
                }),
            };
        }

        if (error instanceof FolderAlreadyExistsError) {
            return {
                statusCode: 409,
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
