import { DTO } from '@devyethiha/samjs';
import { UpdateTeamMemberRoleSchema, UpdateTeamMemberRoleInput } from '@sale-sync/shared';

export type { UpdateTeamMemberRoleInput };

export class UpdateTeamMemberRoleDTO extends DTO<typeof UpdateTeamMemberRoleSchema> {
    constructor() {
        super(UpdateTeamMemberRoleSchema);
    }
}
