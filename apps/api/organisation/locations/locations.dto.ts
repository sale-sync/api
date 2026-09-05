import { DTO } from '@devyethiha/samjs';
import { UpdateLocationsDraftSchema, UpdateLocationsDraftInput } from '@sale-sync/shared';

export type { UpdateLocationsDraftInput };

export class UpdateLocationsDraftDTO extends DTO<typeof UpdateLocationsDraftSchema> {
    constructor() {
        super(UpdateLocationsDraftSchema);
    }
}
