import { z } from 'zod';
import {
    ListContentsSchema,
    CreateFolderSchema,
    UploadMediaSchema,
    GetItemSchema,
    MoveItemSchema,
    RenameItemSchema,
    DeleteItemSchema,
    UploadPropertyImageSchema,
    DeletePropertyImageSchema,
    UploadOrganisationImageSchema,
    DeleteOrganisationImageSchema,
} from '@sale-sync/shared';

const security: Array<Record<string, string[]>> = [{ bearerAuth: [] }, { organisationAuth: [] }];

const FolderSchema = z.object({
    id: z.string(),
    name: z.string(),
    path: z.string(),
    parent_id: z.string(),
    level: z.number(),
    created_at: z.string(),
    created_by: z.string(),
});

const MediaItemSchema = z.object({
    id: z.string(),
    name: z.string(),
    mime_type: z.string(),
    size: z.number(),
    url: z.string(),
    thumbnail_url: z.string().nullable(),
    status: z.enum(['pending', 'ready', 'error']),
    created_at: z.string(),
    created_by: z.string(),
});

const MovedOrRenamedResult = z.object({
    id: z.string(),
    name: z.string(),
    path: z.string(),
    folder_id: z.string(),
});

export const mediaPaths = {
    '/media': {
        get: {
            tags: ['Media'],
            summary: 'List folder contents',
            description: 'Returns the current folder, breadcrumbs, sub-folders, and media items.',
            security,
            requestParams: {
                query: ListContentsSchema,
            },
            responses: {
                '200': {
                    description: 'Folder contents',
                    content: {
                        'application/json': {
                            schema: z.object({
                                folder: FolderSchema,
                                breadcrumbs: z.array(z.object({ id: z.string(), name: z.string() })),
                                folders: z.array(
                                    FolderSchema.extend({
                                        item_count: z.number(),
                                        subfolder_count: z.number(),
                                    }),
                                ),
                                media: z.array(MediaItemSchema),
                            }),
                        },
                    },
                },
                '401': { description: 'Unauthorized' },
                '403': { description: 'No organisation context' },
                '404': { description: 'Folder not found' },
            },
        },
    },
    '/media/folders': {
        post: {
            tags: ['Media'],
            summary: 'Create a folder',
            security,
            requestBody: {
                content: {
                    'application/json': { schema: CreateFolderSchema },
                },
            },
            responses: {
                '201': {
                    description: 'Folder created',
                    content: { 'application/json': { schema: FolderSchema } },
                },
                '400': { description: 'Validation error or max depth exceeded' },
                '401': { description: 'Unauthorized' },
                '403': { description: 'No organisation context' },
                '404': { description: 'Parent folder not found' },
                '409': { description: 'Folder already exists' },
            },
        },
    },
    '/media/upload': {
        post: {
            tags: ['Media'],
            summary: 'Get a presigned S3 upload URL',
            description: 'Creates a pending media record and returns a presigned S3 POST URL for direct upload.',
            security,
            requestBody: {
                content: {
                    'application/json': { schema: UploadMediaSchema },
                },
            },
            responses: {
                '201': {
                    description: 'Presigned upload URL',
                    content: {
                        'application/json': {
                            schema: z.object({
                                media_id: z.string(),
                                upload_url: z.string(),
                                upload_fields: z.record(z.string(), z.string()),
                                expires_at: z.string(),
                            }),
                        },
                    },
                },
                '400': { description: 'Validation error' },
                '401': { description: 'Unauthorized' },
                '403': { description: 'No organisation context' },
                '404': { description: 'Target folder not found' },
            },
        },
    },
    '/media/items': {
        get: {
            tags: ['Media'],
            summary: 'Get media item details',
            security,
            requestParams: {
                query: GetItemSchema,
            },
            responses: {
                '200': {
                    description: 'Media item details',
                    content: {
                        'application/json': {
                            schema: MediaItemSchema.extend({
                                path: z.string(),
                                folder_id: z.string(),
                                s3_key: z.string(),
                                metadata: z.record(z.string(), z.unknown()).nullable(),
                                updated_at: z.string(),
                            }),
                        },
                    },
                },
                '400': { description: 'Missing item_id' },
                '401': { description: 'Unauthorized' },
                '403': { description: 'No organisation context' },
                '404': { description: 'Media item not found' },
            },
        },
        delete: {
            tags: ['Media'],
            summary: 'Delete a media item or folder',
            description: 'Deletes a media file (and its S3 object) or a folder and all its contents recursively.',
            security,
            requestParams: {
                query: DeleteItemSchema,
            },
            responses: {
                '200': {
                    description: 'Item deleted',
                    content: {
                        'application/json': {
                            schema: z.object({
                                message: z.string(),
                                id: z.string(),
                                deleted_at: z.string(),
                            }),
                        },
                    },
                },
                '400': { description: 'Missing item_id' },
                '401': { description: 'Unauthorized' },
                '403': { description: 'No organisation context' },
                '404': { description: 'Item not found' },
            },
        },
    },
    '/media/properties': {
        post: {
            tags: ['Media'],
            summary: 'Get a presigned upload URL for a property image',
            description:
                'Stores property images separately from the Folder/Media library: no DynamoDB record is created. Returns a presigned S3 PUT URL for direct upload and a durable CDN URL to store on the Property record.',
            security,
            requestBody: {
                content: {
                    'application/json': { schema: UploadPropertyImageSchema },
                },
            },
            responses: {
                '201': {
                    description: 'Presigned upload URL and durable image URL',
                    content: {
                        'application/json': {
                            schema: z.object({
                                image_url: z.string(),
                                upload_url: z.string(),
                                s3_key: z.string(),
                                expires_at: z.string(),
                            }),
                        },
                    },
                },
                '400': { description: 'Validation error' },
                '401': { description: 'Unauthorized' },
                '403': { description: 'No organisation context' },
            },
        },
        delete: {
            tags: ['Media'],
            summary: 'Delete a property image',
            description: 'Deletes the S3 object for a property image. No DynamoDB record exists for it.',
            security,
            requestBody: {
                content: {
                    'application/json': { schema: DeletePropertyImageSchema },
                },
            },
            responses: {
                '200': {
                    description: 'Property image deleted',
                    content: {
                        'application/json': {
                            schema: z.object({
                                message: z.string(),
                                s3_key: z.string(),
                            }),
                        },
                    },
                },
                '400': { description: 'Validation error' },
                '401': { description: 'Unauthorized' },
                '403': { description: 'No organisation context, or s3_key outside caller\'s org/properties scope' },
            },
        },
    },
    '/media/organisation': {
        post: {
            tags: ['Media'],
            summary: 'Get a presigned upload URL for an organisation image',
            description:
                'Stores organisation images (logo) separately from the Folder/Media library: no DynamoDB record is created. Returns a presigned S3 PUT URL for direct upload and a durable CDN URL to store on the Organisation record.',
            security,
            requestBody: {
                content: {
                    'application/json': { schema: UploadOrganisationImageSchema },
                },
            },
            responses: {
                '201': {
                    description: 'Presigned upload URL and durable image URL',
                    content: {
                        'application/json': {
                            schema: z.object({
                                image_url: z.string(),
                                upload_url: z.string(),
                                s3_key: z.string(),
                                expires_at: z.string(),
                            }),
                        },
                    },
                },
                '400': { description: 'Validation error' },
                '401': { description: 'Unauthorized' },
                '403': { description: 'No organisation context' },
            },
        },
        delete: {
            tags: ['Media'],
            summary: 'Delete an organisation image',
            description: 'Deletes the S3 object for an organisation image. No DynamoDB record exists for it.',
            security,
            requestBody: {
                content: {
                    'application/json': { schema: DeleteOrganisationImageSchema },
                },
            },
            responses: {
                '200': {
                    description: 'Organisation image deleted',
                    content: {
                        'application/json': {
                            schema: z.object({
                                message: z.string(),
                                s3_key: z.string(),
                            }),
                        },
                    },
                },
                '400': { description: 'Validation error' },
                '401': { description: 'Unauthorized' },
                '403': { description: 'No organisation context, or s3_key outside caller\'s org/organisation scope' },
            },
        },
    },
    '/media/{item_id}/move': {
        patch: {
            tags: ['Media'],
            summary: 'Move a media item or folder',
            security,
            requestParams: {
                path: z.object({
                    item_id: z.string().meta({ description: 'ID of the item to move' }),
                }),
            },
            requestBody: {
                content: {
                    'application/json': { schema: MoveItemSchema },
                },
            },
            responses: {
                '200': {
                    description: 'Item moved',
                    content: {
                        'application/json': {
                            schema: MovedOrRenamedResult.extend({ moved_at: z.string() }),
                        },
                    },
                },
                '400': { description: 'Validation error or circular move' },
                '401': { description: 'Unauthorized' },
                '403': { description: 'No organisation context' },
                '404': { description: 'Item or target folder not found' },
            },
        },
    },
    '/media/{item_id}/rename': {
        patch: {
            tags: ['Media'],
            summary: 'Rename a media item or folder',
            security,
            requestParams: {
                path: z.object({
                    item_id: z.string().meta({ description: 'ID of the item to rename' }),
                }),
            },
            requestBody: {
                content: {
                    'application/json': { schema: RenameItemSchema },
                },
            },
            responses: {
                '200': {
                    description: 'Item renamed',
                    content: {
                        'application/json': {
                            schema: MovedOrRenamedResult.omit({ folder_id: true }).extend({
                                renamed_at: z.string(),
                            }),
                        },
                    },
                },
                '400': { description: 'Validation error' },
                '401': { description: 'Unauthorized' },
                '403': { description: 'No organisation context' },
                '404': { description: 'Item not found' },
            },
        },
    },
};
