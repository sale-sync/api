import { DTO } from '@devyethiha/samjs';
import {
    ContactSubmissionIdQuerySchema,
    ListContactSubmissionsQuerySchema,
    UpdateContactSubmissionSchema,
} from '@sale-sync/shared';

export class ListContactSubmissionsQueryDTO extends DTO<typeof ListContactSubmissionsQuerySchema> {
    constructor() {
        super(ListContactSubmissionsQuerySchema);
    }
}

export class ContactSubmissionIdQueryDTO extends DTO<typeof ContactSubmissionIdQuerySchema> {
    constructor() {
        super(ContactSubmissionIdQuerySchema);
    }
}

export class UpdateContactSubmissionDTO extends DTO<typeof UpdateContactSubmissionSchema> {
    constructor() {
        super(UpdateContactSubmissionSchema);
    }
}
