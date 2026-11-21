import { DTO } from '@devyethiha/samjs';
import { UpdateArticlesDraftSchema, UpdateArticlesDraftInput } from '@sale-sync/shared';

export type { UpdateArticlesDraftInput };

export class UpdateArticlesDraftDTO extends DTO<typeof UpdateArticlesDraftSchema> {
    constructor() {
        super(UpdateArticlesDraftSchema);
    }
}
