import { DTO } from '@devyethiha/samjs';
import { UpdateHomePageDraftSchema, UpdateHomePageDraftInput } from '@sale-sync/shared';

export type { UpdateHomePageDraftInput };

export class UpdateHomePageDraftDTO extends DTO<typeof UpdateHomePageDraftSchema> {
    constructor() {
        super(UpdateHomePageDraftSchema);
    }
}
