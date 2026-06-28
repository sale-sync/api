import { DTO } from '@devyethiha/samjs';
import { IB2BContact, IB2CContact, IContact, IContactItem } from '@sales-sync/shared';
import { editB2BContactSchema } from '@sales-sync/shared';

export type ICreateContactDto = Omit<IContact, 'id'>;

export type IAddContactItemDto =
    | ({ contact_id: string } & Omit<IB2BContact, 'id' | 'added_date' | 'updated_date'>)
    | ({ contact_id: string } & Omit<IB2CContact, 'id' | 'added_date' | 'updated_date'>);

export type IEditContactItemDto = {
    contact_id: string;
    id: string;
} & IContactItem;

export class EditB2BContactDTO extends DTO<typeof editB2BContactSchema> {
    constructor() {
        super(editB2BContactSchema);
    }
}
