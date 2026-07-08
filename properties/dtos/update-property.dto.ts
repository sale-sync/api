import { DTO } from '@devyethiha/samjs';
import { UpdatePropertySchema, UpdatePropertyInput } from '@sale-sync/shared';

export type { UpdatePropertyInput };

export class UpdatePropertyDTO extends DTO<typeof UpdatePropertySchema> {
    constructor() {
        super(UpdatePropertySchema);
    }
}
