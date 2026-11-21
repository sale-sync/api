import { DTO } from '@devyethiha/samjs';
import { UpdateSocialsDraftSchema, UpdateSocialsDraftInput } from '@sale-sync/shared';

export type { UpdateSocialsDraftInput };

export class UpdateSocialsDraftDTO extends DTO<typeof UpdateSocialsDraftSchema> {
    constructor() {
        super(UpdateSocialsDraftSchema);
    }
}
