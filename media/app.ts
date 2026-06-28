import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Router, withCORS } from '@devyethiha/samjs';
import DefaultController from './default/default.controller';
import UploadController from './upload/upload.controller';
import FoldersController from './folders/folders.controller';
import ItemController from './item/item.controller';
import { MediaService } from './services/media.service';
import { FolderService } from './services/folder.service';
import { S3Service } from './services/s3.service';

async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const region = 'ap-southeast-2';

    try {
        const router = new Router(
            event,
            region,
            [
                {
                    controller: DefaultController,
                    services: [MediaService, FolderService],
                },
                {
                    controller: UploadController,
                    services: [MediaService, FolderService, S3Service],
                },
                {
                    controller: FoldersController,
                    services: [FolderService],
                },
                {
                    controller: ItemController,
                    services: [MediaService, FolderService, S3Service],
                },
            ],
            '/media',
        );

        return await router.handle();
    } catch (err) {
        console.error('Media API Error:', err);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Internal server error' }),
        };
    }
}

export const lambdaHandler = withCORS(main, [
    'https://app.salesync.biz',
    'https://staging.salesync.biz',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'https://app.salesync.local',
]);
