import { DTO } from '@devyethiha/samjs';
import {
    createBlockSchema,
    CreateBlockDto,
    updateBlockSchema,
    UpdateBlockDto,
    validateBlockSchema,
    ValidateBlockDto,
    validateBatchSchema,
    ValidateBatchDto,
} from '@sale-sync/shared';

export type { CreateBlockDto, UpdateBlockDto, ValidateBlockDto, ValidateBatchDto };
export { validateBatchSchema };

export class CreateBlockDTO extends DTO<typeof createBlockSchema> {
    constructor() {
        super(createBlockSchema);
    }
}

export class UpdateBlockDTO extends DTO<typeof updateBlockSchema> {
    constructor() {
        super(updateBlockSchema);
    }
}

export class ValidateBlockDTO extends DTO<typeof validateBlockSchema> {
    constructor() {
        super(validateBlockSchema);
    }
}
