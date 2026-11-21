import { DTO } from '@devyethiha/samjs';
import { CreateUnitSchema, CreateUnitInput } from '@sale-sync/shared';

export type { CreateUnitInput };

export class CreateUnitDTO extends DTO<typeof CreateUnitSchema> {
    constructor() {
        super(CreateUnitSchema);
    }
}
