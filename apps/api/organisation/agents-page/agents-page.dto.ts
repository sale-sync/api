import { DTO } from '@devyethiha/samjs';
import { UpdateAgentsPageDraftSchema, UpdateAgentsPageDraftInput } from '@sale-sync/shared';

export type { UpdateAgentsPageDraftInput };

export class UpdateAgentsPageDraftDTO extends DTO<typeof UpdateAgentsPageDraftSchema> {
    constructor() {
        super(UpdateAgentsPageDraftSchema);
    }
}
