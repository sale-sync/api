import { DTO } from '@devyethiha/samjs';
import {
    ListContentsSchema,
    ListContentsInput,
    CreateFolderSchema,
    CreateFolderInput,
    UploadMediaSchema,
    UploadMediaInput,
    MoveItemSchema,
    MoveItemInput,
    RenameItemSchema,
    RenameItemInput,
    DeleteItemSchema,
    DeleteItemInput,
    GetItemSchema,
    GetItemParam,
    UploadPropertyImageSchema,
    UploadPropertyImageInput,
    DeletePropertyImageSchema,
    DeletePropertyImageInput,
} from '@sale-sync/shared';

export type {
    ListContentsInput,
    CreateFolderInput,
    UploadMediaInput,
    MoveItemInput,
    RenameItemInput,
    DeleteItemInput,
    GetItemParam,
    UploadPropertyImageInput,
    DeletePropertyImageInput,
};

export class ListContentsDTO extends DTO<typeof ListContentsSchema> {
    constructor() {
        super(ListContentsSchema);
    }
}

export class CreateFolderDTO extends DTO<typeof CreateFolderSchema> {
    constructor() {
        super(CreateFolderSchema);
    }
}

export class UploadMediaDTO extends DTO<typeof UploadMediaSchema> {
    constructor() {
        super(UploadMediaSchema);
    }
}

export class MoveItemDTO extends DTO<typeof MoveItemSchema> {
    constructor() {
        super(MoveItemSchema);
    }
}

export class RenameItemDTO extends DTO<typeof RenameItemSchema> {
    constructor() {
        super(RenameItemSchema);
    }
}

export class DeleteItemDTO extends DTO<typeof DeleteItemSchema> {
    constructor() {
        super(DeleteItemSchema);
    }
}

export class GetItemDTO extends DTO<typeof GetItemSchema> {
    constructor() {
        super(GetItemSchema);
    }
}

export class UploadPropertyImageDTO extends DTO<typeof UploadPropertyImageSchema> {
    constructor() {
        super(UploadPropertyImageSchema);
    }
}

export class DeletePropertyImageDTO extends DTO<typeof DeletePropertyImageSchema> {
    constructor() {
        super(DeletePropertyImageSchema);
    }
}
