import { DTO } from '@devyethiha/samjs';
import { UpdatePrivacyPolicyDraftSchema, UpdatePrivacyPolicyDraftInput } from '@sale-sync/shared';

export type { UpdatePrivacyPolicyDraftInput };

export class UpdatePrivacyPolicyDraftDTO extends DTO<typeof UpdatePrivacyPolicyDraftSchema> {
    constructor() {
        super(UpdatePrivacyPolicyDraftSchema);
    }
}
