import { DTO } from '@devyethiha/samjs';
import { RemoveTeamMemberSchema, RemoveTeamMemberInput } from '@sale-sync/shared';

export type { RemoveTeamMemberInput };

export class RemoveTeamMemberDTO extends DTO<typeof RemoveTeamMemberSchema> {
    constructor() {
        super(RemoveTeamMemberSchema);
    }
}
