import { DTO } from '@devyethiha/samjs';
import { ApplicationSchema, LinkSchema, PayoutMethodSchema, ProfileSchema } from './schemas';

export class ApplicationDTO extends DTO<typeof ApplicationSchema> {
    constructor() {
        super(ApplicationSchema);
    }
}
export class ProfileDTO extends DTO<typeof ProfileSchema> {
    constructor() {
        super(ProfileSchema);
    }
}
export class LinkDTO extends DTO<typeof LinkSchema> {
    constructor() {
        super(LinkSchema);
    }
}
export class PayoutMethodDTO extends DTO<typeof PayoutMethodSchema> {
    constructor() {
        super(PayoutMethodSchema);
    }
}
