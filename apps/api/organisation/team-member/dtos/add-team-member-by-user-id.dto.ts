import { DTO } from '@devyethiha/samjs';
import { AddTeamMemberByUserIdSchema, AddTeamMemberByUserIdInput } from '@sale-sync/shared';

export type { AddTeamMemberByUserIdInput };

export class AddTeamMemberByUserIdDTO extends DTO<typeof AddTeamMemberByUserIdSchema> {
    constructor() {
        super(AddTeamMemberByUserIdSchema);
    }
}
