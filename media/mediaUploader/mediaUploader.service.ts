import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { Service } from '@devyethiha/samjs';

// const BUCKET_NAME = 'sales-sync-media';
// const EXPIRATION_SECONDS = 300;

export interface IMediaUploaderService {
    getPresignedURL(): Promise<any>;
}

export class MediaUploaderService extends Service implements IMediaUploaderService {
    constructor() {
        super('media-uploader');
    }

    public async getPresignedURL() {
        if (!BUCKET_NAME) {
            console.error('S3_BUCKET_NAME environment variable is not set.');
            return { statusCode: 500, body: JSON.stringify({ message: 'Server configuration error.' }) };
        }
    }
}
