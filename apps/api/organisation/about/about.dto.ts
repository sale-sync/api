import { DTO } from '@devyethiha/samjs';
import { UpdateAboutDraftSchema, UpdateAboutDraftInput } from '@sale-sync/shared';

export type { UpdateAboutDraftInput };

export class UpdateAboutDraftDTO extends DTO<typeof UpdateAboutDraftSchema> {
    constructor() {
        super(UpdateAboutDraftSchema);
    }
}
