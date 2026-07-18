import { DTO } from '@devyethiha/samjs';
import { CreatePropertySchema, CreatePropertyInput } from '@sale-sync/shared';

export type { CreatePropertyInput };

export class CreatePropertyDTO extends DTO<typeof CreatePropertySchema> {
    constructor() {
        super(CreatePropertySchema);
    }
}
