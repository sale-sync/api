import { DTO } from '@devyethiha/samjs';
import { PublishPropertySchema, PublishPropertyInput } from '@sale-sync/shared';

export type { PublishPropertyInput };

export class PublishPropertyDTO extends DTO<typeof PublishPropertySchema> {
    constructor() {
        super(PublishPropertySchema);
    }
}
