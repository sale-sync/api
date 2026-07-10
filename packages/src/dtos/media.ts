import { z } from 'zod';

export const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

export const ALLOWED_MIME_TYPES = [
    // Images
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'image/bmp',
    'image/tiff',
    // Documents
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // Video
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'video/x-msvideo',
    // Audio
    'audio/mpeg',
    'audio/wav',
    'audio/ogg',
    'audio/webm',
    // Archives
    'application/zip',
    'application/x-rar-compressed',
    // Text
    'text/plain',
    'text/csv',
    'application/json',
];

export const ListContentsSchema = z.object({
    folder_id: z.string().optional().default('root'),
});

export type ListContentsInput = z.infer<typeof ListContentsSchema>;

export const CreateFolderSchema = z.object({
    parent_id: z.string().optional().default('root'),
    name: z
        .string()
        .min(1, 'Folder name is required')
        .max(255, 'Folder name must be 255 characters or less')
        .refine((name) => !name.includes('/') && !name.includes('\\'), 'Folder name cannot contain / or \\ characters'),
});

export type CreateFolderInput = z.infer<typeof CreateFolderSchema>;

export const UploadMediaSchema = z.object({
    folder_id: z
        .string()
        .nullable()
        .optional()
        .transform((val) => val ?? 'root'),
    file_name: z.string().min(1, 'file_name is required').max(255, 'file_name must be 255 characters or less'),
    mime_type: z
        .string()
        .min(1, 'mime_type is required')
        .refine((type) => ALLOWED_MIME_TYPES.includes(type), 'Unsupported file type'),
});

export type UploadMediaInput = z.infer<typeof UploadMediaSchema>;

export const MoveItemSchema = z.object({
    target_folder_id: z.string().min(1, 'target_folder_id is required'),
    item_type: z.enum(['media', 'folder'], {
        error: "item_type must be 'media' or 'folder'",
    }),
});

export type MoveItemInput = z.infer<typeof MoveItemSchema>;

export const RenameItemSchema = z.object({
    name: z
        .string()
        .min(1, 'name is required')
        .max(255, 'name must be 255 characters or less')
        .refine((name) => !name.includes('/') && !name.includes('\\'), 'name cannot contain / or \\ characters'),
    item_type: z.enum(['media', 'folder'], {
        error: "item_type must be 'media' or 'folder'",
    }),
});

export type RenameItemInput = z.infer<typeof RenameItemSchema>;

export const DeleteItemSchema = z.object({
    item_id: z.string('Missing item_id param'),
    item_type: z.enum(['media', 'folder'], {
        error: "item_type must be 'media' or 'folder'",
    }),
});

export type DeleteItemInput = z.infer<typeof DeleteItemSchema>;

export const GetItemSchema = z.object({
    item_id: z.string('Missing item_id param'),
});

export type GetItemParam = z.infer<typeof GetItemSchema>;

export const ALLOWED_PROPERTY_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

export const UploadPropertyImageSchema = z.object({
    file_name: z.string().min(1, 'file_name is required').max(255, 'file_name must be 255 characters or less'),
    mime_type: z
        .string()
        .min(1, 'mime_type is required')
        .refine((type) => ALLOWED_PROPERTY_IMAGE_MIME_TYPES.includes(type), 'Unsupported image type'),
});

export type UploadPropertyImageInput = z.infer<typeof UploadPropertyImageSchema>;

export const DeletePropertyImageSchema = z.object({
    s3_key: z.string().min(1, 'Missing s3_key param'),
});

export type DeletePropertyImageInput = z.infer<typeof DeletePropertyImageSchema>;
