import { DTO } from '@devyethiha/samjs';
import { UpdateContactDraftSchema, UpdateContactDraftInput } from '@sale-sync/shared';

export type { UpdateContactDraftInput };

export class UpdateContactDraftDTO extends DTO<typeof UpdateContactDraftSchema> {
    constructor() {
        super(UpdateContactDraftSchema);
    }
}
