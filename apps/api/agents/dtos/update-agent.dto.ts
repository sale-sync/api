import { DTO } from '@devyethiha/samjs';
import { UpdateAgentSchema, UpdateAgentInput } from '@sale-sync/shared';

export type { UpdateAgentInput };

export class UpdateAgentDTO extends DTO<typeof UpdateAgentSchema> {
    constructor() {
        super(UpdateAgentSchema);
    }
}
