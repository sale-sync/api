import { DTO } from '@devyethiha/samjs';
import { AddTeamMemberSchema, AddTeamMemberInput } from '@sale-sync/shared';

export type { AddTeamMemberInput };

export class AddTeamMemberDTO extends DTO<typeof AddTeamMemberSchema> {
    constructor() {
        super(AddTeamMemberSchema);
    }
}
