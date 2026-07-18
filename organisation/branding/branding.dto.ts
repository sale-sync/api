import { DTO } from '@devyethiha/samjs';
import { UpdateBrandingDraftSchema, UpdateBrandingDraftInput } from '@sale-sync/shared';

export type { UpdateBrandingDraftInput };

export class UpdateBrandingDraftDTO extends DTO<typeof UpdateBrandingDraftSchema> {
    constructor() {
        super(UpdateBrandingDraftSchema);
    }
}
