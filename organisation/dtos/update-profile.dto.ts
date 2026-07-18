import { DTO } from '@devyethiha/samjs';
import { UpdateProfileSchema, UpdateProfileInput } from '@sale-sync/shared';

export type { UpdateProfileInput };

export class UpdateProfileDTO extends DTO<typeof UpdateProfileSchema> {
    constructor() {
        super(UpdateProfileSchema);
    }
}
