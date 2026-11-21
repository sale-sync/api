import { DTO } from '@devyethiha/samjs';
import { LinkAgentSchema, LinkAgentInput } from '@sale-sync/shared';

export type { LinkAgentInput };

export class LinkAgentDTO extends DTO<typeof LinkAgentSchema> {
    constructor() {
        super(LinkAgentSchema);
    }
}
