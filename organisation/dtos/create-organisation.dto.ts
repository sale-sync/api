import { DTO } from '@devyethiha/samjs';
import { CreateOrganisationSchema, CreateOrganisationInput } from '@sales-sync/shared';

export type { CreateOrganisationInput };

export class CreateOrganisationDTO extends DTO<typeof CreateOrganisationSchema> {
    constructor() {
        super(CreateOrganisationSchema);
    }
}
