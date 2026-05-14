import { Service, IService } from '@devyethiha/samjs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const UPLOAD_URL_EXPIRY = 3600; // 1 hour
const DOWNLOAD_URL_EXPIRY = 3600; // 1 hour

export interface UploadUrlResult {
    upload_url: string;
    upload_fields: {
        key: string;
        'Content-Type': string;
        'x-amz-meta-media-id': string;
    };
    expires_at: string;
}

export interface DownloadUrlResult {
    download_url: string;
    file_name: string;
    mime_type: string;
    size: number;
    expires_at: string;
}

export class S3Service extends Service implements IService {
    private s3Client: S3Client;
    private bucketName: string;
    private region: string;

    constructor(DB_Client: DynamoDBClient) {
        super('s3');
        this.region = process.env.AWS_REGION || 'ap-southeast-2';
        this.s3Client = new S3Client({ region: this.region });
        this.bucketName = process.env.S3_BUCKET_NAME || 'sales-sync-media-bucket';
    }

    /**
     * Generate presigned URL for upload
     */
    async generateUploadUrl(s3Key: string, mediaId: string, mimeType: string, size: number): Promise<UploadUrlResult> {
        const command = new PutObjectCommand({
            Bucket: this.bucketName,
            Key: s3Key,
            Metadata: {
                'media-id': mediaId,
            },
        });

        const uploadUrl = await getSignedUrl(this.s3Client, command, {
            expiresIn: UPLOAD_URL_EXPIRY,
        });

        const expiresAt = new Date(Date.now() + UPLOAD_URL_EXPIRY * 1000).toISOString();

        return {
            upload_url: uploadUrl,
            upload_fields: {
                key: s3Key,
                'Content-Type': mimeType,
                'x-amz-meta-media-id': mediaId,
            },
            expires_at: expiresAt,
        };
    }

    /**
     * Generate presigned URL for download
     */
    async generateDownloadUrl(
        s3Key: string,
        fileName: string,
        mimeType: string,
        size: number,
    ): Promise<DownloadUrlResult> {
        const command = new GetObjectCommand({
            Bucket: this.bucketName,
            Key: s3Key,
            ResponseContentDisposition: `attachment; filename="${fileName}"`,
            ResponseContentType: mimeType,
        });

        const downloadUrl = await getSignedUrl(this.s3Client, command, {
            expiresIn: DOWNLOAD_URL_EXPIRY,
        });

        const expiresAt = new Date(Date.now() + DOWNLOAD_URL_EXPIRY * 1000).toISOString();

        return {
            download_url: downloadUrl,
            file_name: fileName,
            mime_type: mimeType,
            size,
            expires_at: expiresAt,
        };
    }

    /**
     * Delete a single object from S3
     */
    async deleteObject(s3Key: string): Promise<void> {
        const command = new DeleteObjectCommand({
            Bucket: this.bucketName,
            Key: s3Key,
        });

        await this.s3Client.send(command);
    }

    /**
     * Delete multiple objects from S3
     */
    async deleteObjects(s3Keys: string[]): Promise<void> {
        if (s3Keys.length === 0) return;

        // S3 DeleteObjects limit is 1000
        const batches = this.chunkArray(s3Keys, 1000);

        for (const batch of batches) {
            const command = new DeleteObjectsCommand({
                Bucket: this.bucketName,
                Delete: {
                    Objects: batch.map((key) => ({ Key: key })),
                },
            });

            await this.s3Client.send(command);
        }
    }

    /**
     * Get the bucket name
     */
    getBucketName(): string {
        return this.bucketName;
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
