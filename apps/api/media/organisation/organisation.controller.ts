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
import { v4 as uuidv4 } from 'uuid';
import { S3Service } from '../services/s3.service';
import { UploadOrganisationImageDTO, DeleteOrganisationImageDTO } from '../dtos/media.dto';
import { AccessDeniedError } from '../errors/media.errors';

export default class OrganisationController extends Controller implements IControllerMethods {
    private s3Service: S3Service;

    constructor(s3Service: S3Service) {
        super('organisation');
        this.s3Service = s3Service;
    }

    /**
     * POST /media/organisation - Get presigned upload URL + durable CDN URL for an organisation image.
     * Stored separately from the Folder/Media library: no DynamoDB record is created.
     *
     * Body: file_name (required), mime_type (required, image types only)
     * Organisation context from Organisation cookie JWT
     */
    async post(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        const user = getUser(event);
        if (!user) return NO_USER;

        const organisation = getOrganisation(event);
        if (!organisation) return NO_ORGANISATION;

        try {
            const dto = new UploadOrganisationImageDTO();
            const { file_name, mime_type } = dto.validate(JSON.parse(event.body || '{}'));

            const s3Key = `cdn/${organisation.uuid}/organisation/${uuidv4()}-${file_name}`;
            const uploadResult = await this.s3Service.generateUploadUrl(s3Key, uuidv4(), mime_type);
            const imageUrl = this.s3Service.getCdnUrl(s3Key);

            return {
                statusCode: 201,
                body: JSON.stringify({
                    image_url: imageUrl,
                    upload_url: uploadResult.upload_url,
                    s3_key: s3Key,
                    expires_at: uploadResult.expires_at,
                }),
            };
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * DELETE /media/organisation - Delete an organisation image object from S3.
     * No DynamoDB record exists for it; the client supplies the s3_key returned at upload time.
     *
     * Body: s3_key (required)
     * Organisation context from Organisation cookie JWT
     */
    async delete(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        const organisation = getOrganisation(event);
        if (!organisation) return NO_ORGANISATION;

        try {
            const dto = new DeleteOrganisationImageDTO();
            const { s3_key } = dto.validate(JSON.parse(event.body || '{}'));

            const expectedPrefix = `cdn/${organisation.uuid}/organisation/`;
            if (!s3_key.startsWith(expectedPrefix)) {
                throw new AccessDeniedError(organisation.uuid);
            }

            await this.s3Service.deleteObject(s3_key);

            return {
                statusCode: 200,
                body: JSON.stringify({ message: 'Organisation image deleted successfully', s3_key }),
            };
        } catch (error) {
            return this.handleError(error);
        }
    }

    private handleError(error: unknown): APIGatewayProxyResult {
        if (error instanceof ValidationError) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'Validation failed', issues: error.issues }),
            };
        }

        if (error instanceof AccessDeniedError) {
            return { statusCode: 403, body: JSON.stringify({ message: error.message }) };
        }

        console.error('Unexpected error:', error);
        return { statusCode: 500, body: JSON.stringify({ message: 'Internal server error' }) };
    }
}
