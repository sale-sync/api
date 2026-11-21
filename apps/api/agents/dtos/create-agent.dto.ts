import { DTO } from '@devyethiha/samjs';
import { CreateAgentSchema, CreateAgentInput } from '@sale-sync/shared';

export type { CreateAgentInput };

export class CreateAgentDTO extends DTO<typeof CreateAgentSchema> {
    constructor() {
        super(CreateAgentSchema);
    }
}
