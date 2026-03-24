import { DTO } from '@devyethiha/samjs';
import { IB2BContact, IB2CContact, IContact, IContactItem } from '@sales-sync/shared';
import { z } from 'zod';

// Refractor: Need to use zod for DTO
export type ICreateContactDto = Omit<IContact, 'id'>;

export type IAddContactItemDto =
    | ({ contact_id: string } & Omit<IB2BContact, 'id' | 'added_date' | 'updated_date'>)
    | ({ contact_id: string } & Omit<IB2CContact, 'id' | 'added_date' | 'updated_date'>);

export type IEditContactItemDto = {
    contact_id: string;
    id: string;
} & IContactItem;

const spokePersonSchema = z.object({
    name: z.string().min(1, 'Spoke person name is required'),
    email: z.email('Invalid spoke person email'),
    phone: z.string().min(1, 'Spoke person phone is required'),
});

const editB2BContactSchema = z.object({
    id: z.uuid('Invalid ID format'),
    contact_id: z.string().min(1, 'Contact ID is required'),
    status: z.string().min(1, 'Status is required'),

    note: z.string().optional().default(''),

    mode: z.literal('b2b'),

    business_name: z.string().min(1, 'Business name is required'),
    business_email: z.email('Invalid business email'),
    business_phone: z.string().min(1, 'Business phone is required'),

    spoke_person: z.array(spokePersonSchema).min(1, 'At least one spoke person is required'),
});

export class EditB2BContactDTO extends DTO<typeof editB2BContactSchema> {
    constructor() {
        super(editB2BContactSchema);
    }
}
