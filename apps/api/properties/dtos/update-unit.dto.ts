import { DTO } from '@devyethiha/samjs';
import { UpdateUnitSchema, UpdateUnitInput } from '@sale-sync/shared';

export type { UpdateUnitInput };

export class UpdateUnitDTO extends DTO<typeof UpdateUnitSchema> {
    constructor() {
        super(UpdateUnitSchema);
    }
}
