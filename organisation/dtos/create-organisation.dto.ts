// organisation/dtos/create-organisation.dto.ts
import { DTO } from '@devyethiha/samjs';
import { z } from 'zod';

const CreateOrganisationSchema = z.object({
    organisation_id: z.string().min(1, 'organisation_id is required'),
    organisation_name: z.string().min(1, 'organisation_name is required'),
});

export type CreateOrganisationInput = z.infer<typeof CreateOrganisationSchema>;

export class CreateOrganisationDTO extends DTO<typeof CreateOrganisationSchema> {
    constructor() {
        super(CreateOrganisationSchema);
    }
}
