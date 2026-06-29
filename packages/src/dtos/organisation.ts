import { z } from 'zod';

const BusinessCategorySchema = z.enum(['fitness', 'real-estate', 'service-business', 'restaurant', 'barber']);

export const CreateOrganisationSchema = z.object({
    organisation_id: z.string().min(1, 'organisation_id is required'),
    organisation_name: z.string().min(1, 'organisation_name is required'),
    business_category: BusinessCategorySchema,
    template_id: z.string().uuid(),
    plan_id: z.string().uuid(),
    description: z.string().optional(),
});

export type CreateOrganisationInput = z.infer<typeof CreateOrganisationSchema>;
