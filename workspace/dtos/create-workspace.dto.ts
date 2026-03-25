// workspace/dtos/create-workspace.dto.ts
import { DTO } from '@devyethiha/samjs';
import { z } from 'zod';

const CreateWorkspaceSchema = z.object({
    workspace_id: z.string().min(1, 'workspace_id is required'),
    workspace_name: z.string().min(1, 'workspace_name is required'),
});

export type CreateWorkspaceInput = z.infer<typeof CreateWorkspaceSchema>;

export class CreateWorkspaceDTO extends DTO<typeof CreateWorkspaceSchema> {
    constructor() {
        super(CreateWorkspaceSchema);
    }
}
