import { DTO } from '@devyethiha/samjs';
import { UpdateTermsAndConditionsDraftSchema, UpdateTermsAndConditionsDraftInput } from '@sale-sync/shared';

export type { UpdateTermsAndConditionsDraftInput };

export class UpdateTermsAndConditionsDraftDTO extends DTO<typeof UpdateTermsAndConditionsDraftSchema> {
    constructor() {
        super(UpdateTermsAndConditionsDraftSchema);
    }
}
