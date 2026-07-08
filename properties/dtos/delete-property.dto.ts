import { DTO } from '@devyethiha/samjs';
import { DeletePropertySchema, DeletePropertyInput } from '@sales-sync/shared';

export type { DeletePropertyInput };

export class DeletePropertyDTO extends DTO<typeof DeletePropertySchema> {
    constructor() {
        super(DeletePropertySchema);
    }
}
