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
import { OrganisationMembershipService, InsufficientRoleError } from '../services/organisation-membership.service';
import { UploadBlockImageDTO, DeleteBlockImageDTO } from '../dtos/media.dto';
import { AccessDeniedError } from '../errors/media.errors';

export default class BlockController extends Controller implements IControllerMethods {
    private s3Service: S3Service;
    private membershipService: OrganisationMembershipService;

    constructor(s3Service: S3Service, membershipService: OrganisationMembershipService) {
        super('block');
        this.s3Service = s3Service;
        this.membershipService = membershipService;
    }

    /**
     * POST /media/block - Get presigned upload URL + durable CDN URL for an image embedded directly
     * inside a BlockNote document (web-app's About editor, via its `uploadFile` option — as opposed
     * to a user-pasted embed URL). Stored under the org's `organisation/` prefix, in its own `block/`
     * subfolder. No DynamoDB record is created; the resulting URL lives inside the BlockNote JSON
     * itself (organisations.about's `data`/`draft`), not this table.
     * Restricted to owner/admin, same as the About write API (api/organisation/about) it feeds.
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
            await this.membershipService.assertCanManageOrganisation(organisation.uuid, user.id);

            const dto = new UploadBlockImageDTO();
            const { file_name, mime_type } = dto.validate(JSON.parse(event.body || '{}'));

            const s3Key = `cdn/${organisation.uuid}/organisation/block/${uuidv4()}-${file_name}`;
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
     * DELETE /media/block - Delete a block image object from S3.
     * No DynamoDB record exists for it; the client supplies the s3_key returned at upload time.
     * Restricted to owner/admin.
     *
     * Body: s3_key (required)
     * Organisation context from Organisation cookie JWT
     */
    async delete(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        const user = getUser(event);
        if (!user) return NO_USER;

        const organisation = getOrganisation(event);
        if (!organisation) return NO_ORGANISATION;

        try {
            await this.membershipService.assertCanManageOrganisation(organisation.uuid, user.id);

            const dto = new DeleteBlockImageDTO();
            const { s3_key } = dto.validate(JSON.parse(event.body || '{}'));

            const expectedPrefix = `cdn/${organisation.uuid}/organisation/block/`;
            if (!s3_key.startsWith(expectedPrefix)) {
                throw new AccessDeniedError(organisation.uuid);
            }

            await this.s3Service.deleteObject(s3_key);

            return {
                statusCode: 200,
                body: JSON.stringify({ message: 'Block image deleted successfully', s3_key }),
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

        if (error instanceof InsufficientRoleError) {
            return { statusCode: 403, body: JSON.stringify({ message: error.message }) };
        }

        if (error instanceof AccessDeniedError) {
            return { statusCode: 403, body: JSON.stringify({ message: error.message }) };
        }

        console.error('Unexpected error:', error);
        return { statusCode: 500, body: JSON.stringify({ message: 'Internal server error' }) };
    }
}
