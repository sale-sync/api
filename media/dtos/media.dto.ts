import { DTO } from '@devyethiha/samjs';
import { z } from 'zod';

// ============================================================================
// List Contents DTO (Query params)
// ============================================================================

const ListContentsSchema = z.object({
    folder_id: z.string().optional().default('root'),
});

export type ListContentsInput = z.infer<typeof ListContentsSchema>;

export class ListContentsDTO extends DTO<typeof ListContentsSchema> {
    constructor() {
        super(ListContentsSchema);
    }
}

// ============================================================================
// Create Folder DTO
// ============================================================================

const CreateFolderSchema = z.object({
    parent_id: z.string().optional().default('root'),
    name: z
        .string()
        .min(1, 'Folder name is required')
        .max(255, 'Folder name must be 255 characters or less')
        .refine((name) => !name.includes('/') && !name.includes('\\'), 'Folder name cannot contain / or \\ characters'),
});

export type CreateFolderInput = z.infer<typeof CreateFolderSchema>;

export class CreateFolderDTO extends DTO<typeof CreateFolderSchema> {
    constructor() {
        super(CreateFolderSchema);
    }
}

// ============================================================================
// Upload Media DTO
// ============================================================================

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

const ALLOWED_MIME_TYPES = [
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

const UploadMediaSchema = z.object({
    folder_id: z.string().optional().default('root'),
    file_name: z.string().min(1, 'file_name is required').max(255, 'file_name must be 255 characters or less'),
    mime_type: z
        .string()
        .min(1, 'mime_type is required')
        .refine((type) => ALLOWED_MIME_TYPES.includes(type), 'Unsupported file type'),
});

export type UploadMediaInput = z.infer<typeof UploadMediaSchema>;

export class UploadMediaDTO extends DTO<typeof UploadMediaSchema> {
    constructor() {
        super(UploadMediaSchema);
    }
}

// ============================================================================
// Move Item DTO
// ============================================================================

const MoveItemSchema = z.object({
    target_folder_id: z.string().min(1, 'target_folder_id is required'),
    item_type: z.enum(['media', 'folder'], {
        error: "item_type must be 'media' or 'folder'",
    }),
});

export type MoveItemInput = z.infer<typeof MoveItemSchema>;

export class MoveItemDTO extends DTO<typeof MoveItemSchema> {
    constructor() {
        super(MoveItemSchema);
    }
}

// ============================================================================
// Rename Item DTO
// ============================================================================

const RenameItemSchema = z.object({
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

export class RenameItemDTO extends DTO<typeof RenameItemSchema> {
    constructor() {
        super(RenameItemSchema);
    }
}

// ============================================================================
// Delete Item DTO (Query params)
// ============================================================================

const DeleteItemSchema = z.object({
    item_id: z.string('Missing item_id param'),
    item_type: z.enum(['media', 'folder'], {
        error: "item_type must be 'media' or 'folder'",
    }),
});

export type DeleteItemInput = z.infer<typeof DeleteItemSchema>;

export class DeleteItemDTO extends DTO<typeof DeleteItemSchema> {
    constructor() {
        super(DeleteItemSchema);
    }
}

// ============================================================================
// GET Item DTO (Query params)
// ============================================================================

const GetItemSchema = z.object({
    item_id: z.string('Missing item_id param'),
});

export type GetItemParam = z.infer<typeof GetItemSchema>;

export class GetItemDTO extends DTO<typeof GetItemSchema> {
    constructor() {
        super(GetItemSchema);
    }
}
