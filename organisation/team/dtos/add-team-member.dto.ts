import { DTO } from '@devyethiha/samjs';
import { AddTeamMemberSchema, AddTeamMemberInput } from '@sales-sync/shared';

export type { AddTeamMemberInput };

export class AddTeamMemberDTO extends DTO<typeof AddTeamMemberSchema> {
    constructor() {
        super(AddTeamMemberSchema);
    }
}
