import { DTO } from '@devyethiha/samjs';
import { UpdateContactFormSchema, UpdateContactFormInput } from '@sale-sync/shared';

export type { UpdateContactFormInput };

export class UpdateContactFormDTO extends DTO<typeof UpdateContactFormSchema> {
    constructor() {
        super(UpdateContactFormSchema);
    }
}
