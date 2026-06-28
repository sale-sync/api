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
import { UploadMediaDTO } from '../dtos/media.dto';
import { ItemNotFoundError, AccessDeniedError } from '../errors/media.errors';

export default class UploadController extends Controller implements IControllerMethods {
    private mediaService!: MediaService;
    private folderService!: FolderService;
    private s3Service!: S3Service;

    constructor(mediaService: MediaService, folderService: FolderService, s3Service: S3Service) {
        super('upload');
        this.mediaService = mediaService;
        this.folderService = folderService;
        this.s3Service = s3Service;
    }

    /**
     * POST /media/upload - Get presigned upload URL
     *
     * Body:
     * - folder_id (optional, default: 'root')
     * - file_name (required)
     * - mime_type (required)
     * - size (required)
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
        console.log({ organisation });
        if (!organisation) {
            return NO_ORGANISATION;
        }

        try {
            const dto = new UploadMediaDTO();
            const body = JSON.parse(event.body || '{}');
            const params = dto.validate(body);

            const { folder_id: raw_folder_id, file_name, mime_type } = params;
            const folder_id = raw_folder_id ?? 'root';

            const organisation_id = organisation.uuid;

            console.log({
                organisation,
                user,
            });

            // Ensure root folder exists
            await this.folderService.ensureRootFolder(organisation_id, user.id);

            // Verify target folder exists
            const folder = await this.folderService.getFolderById(organisation_id, folder_id);
            if (!folder) {
                throw new ItemNotFoundError('folder', folder_id);
            }

            // Create media record (pending status)
            const media = await this.mediaService.createMedia(
                {
                    organisation_id,
                    folder_id,
                    file_name,
                    mime_type,
                    user_id: user.id,
                },
                folder,
            );

            // Generate presigned upload URL
            const uploadResult = await this.s3Service.generateUploadUrl(media.s3_key, media.id, mime_type);

            return {
                statusCode: 201,
                body: JSON.stringify({
                    media_id: media.id,
                    upload_url: uploadResult.upload_url,
                    upload_fields: uploadResult.upload_fields,
                    expires_at: uploadResult.expires_at,
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
