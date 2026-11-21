import { z } from 'zod';

const spokePersonSchema = z.object({
    name: z.string().min(1, 'Spoke person name is required'),
    email: z.email('Invalid spoke person email'),
    phone: z.string().min(1, 'Spoke person phone is required'),
});

export const editB2BContactSchema = z.object({
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

export type EditB2BContactDto = z.infer<typeof editB2BContactSchema>;
