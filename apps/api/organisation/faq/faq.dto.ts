import { DTO } from '@devyethiha/samjs';
import { UpdateFaqDraftSchema, UpdateFaqDraftInput } from '@sale-sync/shared';

export type { UpdateFaqDraftInput };

export class UpdateFaqDraftDTO extends DTO<typeof UpdateFaqDraftSchema> {
    constructor() {
        super(UpdateFaqDraftSchema);
    }
}
