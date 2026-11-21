import { DTO } from '@devyethiha/samjs';
import { AddTemplateSchema, AddTemplateInput } from '@sale-sync/shared';

export type { AddTemplateInput };

export class AddTemplateDTO extends DTO<typeof AddTemplateSchema> {
    constructor() {
        super(AddTemplateSchema);
    }
}
