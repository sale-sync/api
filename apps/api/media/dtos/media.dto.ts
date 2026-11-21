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
    UploadOrganisationImageSchema,
    UploadOrganisationImageInput,
    DeleteOrganisationImageSchema,
    DeleteOrganisationImageInput,
    UploadUserAvatarSchema,
    UploadUserAvatarInput,
    DeleteUserAvatarSchema,
    DeleteUserAvatarInput,
    UploadBrandingImageSchema,
    UploadBrandingImageInput,
    DeleteBrandingImageSchema,
    DeleteBrandingImageInput,
    UploadAgentImageSchema,
    UploadAgentImageInput,
    DeleteAgentImageSchema,
    DeleteAgentImageInput,
    UploadBlockImageSchema,
    UploadBlockImageInput,
    DeleteBlockImageSchema,
    DeleteBlockImageInput,
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
    UploadOrganisationImageInput,
    DeleteOrganisationImageInput,
    UploadUserAvatarInput,
    DeleteUserAvatarInput,
    UploadBrandingImageInput,
    DeleteBrandingImageInput,
    UploadAgentImageInput,
    DeleteAgentImageInput,
    UploadBlockImageInput,
    DeleteBlockImageInput,
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

export class UploadOrganisationImageDTO extends DTO<typeof UploadOrganisationImageSchema> {
    constructor() {
        super(UploadOrganisationImageSchema);
    }
}

export class DeleteOrganisationImageDTO extends DTO<typeof DeleteOrganisationImageSchema> {
    constructor() {
        super(DeleteOrganisationImageSchema);
    }
}

export class UploadUserAvatarDTO extends DTO<typeof UploadUserAvatarSchema> {
    constructor() {
        super(UploadUserAvatarSchema);
    }
}

export class DeleteUserAvatarDTO extends DTO<typeof DeleteUserAvatarSchema> {
    constructor() {
        super(DeleteUserAvatarSchema);
    }
}

export class UploadBrandingImageDTO extends DTO<typeof UploadBrandingImageSchema> {
    constructor() {
        super(UploadBrandingImageSchema);
    }
}

export class DeleteBrandingImageDTO extends DTO<typeof DeleteBrandingImageSchema> {
    constructor() {
        super(DeleteBrandingImageSchema);
    }
}

export class UploadAgentImageDTO extends DTO<typeof UploadAgentImageSchema> {
    constructor() {
        super(UploadAgentImageSchema);
    }
}

export class DeleteAgentImageDTO extends DTO<typeof DeleteAgentImageSchema> {
    constructor() {
        super(DeleteAgentImageSchema);
    }
}

export class UploadBlockImageDTO extends DTO<typeof UploadBlockImageSchema> {
    constructor() {
        super(UploadBlockImageSchema);
    }
}

export class DeleteBlockImageDTO extends DTO<typeof DeleteBlockImageSchema> {
    constructor() {
        super(DeleteBlockImageSchema);
    }
}
