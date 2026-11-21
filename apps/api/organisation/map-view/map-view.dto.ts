import { DTO } from '@devyethiha/samjs';
import { UpdateMapViewDraftSchema, UpdateMapViewDraftInput } from '@sale-sync/shared';

export type { UpdateMapViewDraftInput };

export class UpdateMapViewDraftDTO extends DTO<typeof UpdateMapViewDraftSchema> {
    constructor() {
        super(UpdateMapViewDraftSchema);
    }
}
