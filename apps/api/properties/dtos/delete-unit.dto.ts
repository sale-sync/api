import { DTO } from '@devyethiha/samjs';
import { DeleteUnitSchema, DeleteUnitInput } from '@sale-sync/shared';

export type { DeleteUnitInput };

export class DeleteUnitDTO extends DTO<typeof DeleteUnitSchema> {
    constructor() {
        super(DeleteUnitSchema);
    }
}
