import { DTO } from '@devyethiha/samjs';
import { CreatePropertySchema, CreatePropertyInput } from '@sales-sync/shared';

export type { CreatePropertyInput };

export class CreatePropertyDTO extends DTO<typeof CreatePropertySchema> {
    constructor() {
        super(CreatePropertySchema);
    }
}
