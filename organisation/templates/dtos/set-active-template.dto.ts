import { DTO } from '@devyethiha/samjs';
import { SetActiveTemplateSchema, SetActiveTemplateInput } from '@sales-sync/shared';

export type { SetActiveTemplateInput };

export class SetActiveTemplateDTO extends DTO<typeof SetActiveTemplateSchema> {
    constructor() {
        super(SetActiveTemplateSchema);
    }
}
