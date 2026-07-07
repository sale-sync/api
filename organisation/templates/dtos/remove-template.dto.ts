import { DTO } from '@devyethiha/samjs';
import { RemoveTemplateSchema, RemoveTemplateInput } from '@sales-sync/shared';

export type { RemoveTemplateInput };

export class RemoveTemplateDTO extends DTO<typeof RemoveTemplateSchema> {
    constructor() {
        super(RemoveTemplateSchema);
    }
}
