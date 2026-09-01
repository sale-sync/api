import { DTO } from '@devyethiha/samjs';
import { UpdateTestimonialsDraftSchema, UpdateTestimonialsDraftInput } from '@sale-sync/shared';

export type { UpdateTestimonialsDraftInput };

export class UpdateTestimonialsDraftDTO extends DTO<typeof UpdateTestimonialsDraftSchema> {
    constructor() {
        super(UpdateTestimonialsDraftSchema);
    }
}
