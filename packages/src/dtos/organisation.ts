import { z } from 'zod';

const BusinessCategorySchema = z.enum(['fitness', 'real-estate', 'service-business', 'restaurant', 'haircut-and-salon']);

export const CreateOrganisationSchema = z.object({
    organisation_id: z.string().min(1, 'organisation_id is required'),
    organisation_name: z.string().min(1, 'organisation_name is required'),
    business_category: BusinessCategorySchema,
    template_id: z.string().uuid(),
    plan_id: z.string().uuid(),
    description: z.string().optional(),
});

export type CreateOrganisationInput = z.infer<typeof CreateOrganisationSchema>;

export const AddTeamMemberSchema = z.object({
    org_uuid: z.string().uuid('org_uuid must be a valid UUID'),
    email: z.union([
        z.string().email('email must be a valid email address'),
        z.array(z.string().email('each email must be a valid email address')).min(1, 'email array must not be empty'),
    ]),
});

export type AddTeamMemberInput = z.infer<typeof AddTeamMemberSchema>;
