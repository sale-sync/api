import { DTO } from '@devyethiha/samjs';
import { UpdateOrganisationSchema, UpdateOrganisationInput } from '@sale-sync/shared';

export type { UpdateOrganisationInput };

export class UpdateOrganisationDTO extends DTO<typeof UpdateOrganisationSchema> {
    constructor() {
        super(UpdateOrganisationSchema);
    }
}
