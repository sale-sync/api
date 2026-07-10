import { DTO } from '@devyethiha/samjs';
import { CreateTemplateSchema, CreateTemplateInput } from '@sale-sync/shared';

export type { CreateTemplateInput };

export class CreateTemplateDTO extends DTO<typeof CreateTemplateSchema> {
    constructor() {
        super(CreateTemplateSchema);
    }
}
