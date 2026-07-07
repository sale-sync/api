import { DTO } from '@devyethiha/samjs';
import { UpdateThemeSchema, UpdateThemeInput } from '@sales-sync/shared';

export type { UpdateThemeInput };

export class UpdateThemeDTO extends DTO<typeof UpdateThemeSchema> {
    constructor() {
        super(UpdateThemeSchema);
    }
}
