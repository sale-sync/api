import { DTO } from '@devyethiha/samjs';
import { UpdatePropertiesPageDraftSchema, UpdatePropertiesPageDraftInput } from '@sale-sync/shared';

export type { UpdatePropertiesPageDraftInput };

export class UpdatePropertiesPageDraftDTO extends DTO<typeof UpdatePropertiesPageDraftSchema> {
    constructor() {
        super(UpdatePropertiesPageDraftSchema);
    }
}
