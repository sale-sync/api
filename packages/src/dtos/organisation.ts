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
    email: z.union([
        z.string().email('email must be a valid email address'),
        z.array(z.string().email('each email must be a valid email address')).min(1, 'email array must not be empty'),
    ]),
});

export type AddTeamMemberInput = z.infer<typeof AddTeamMemberSchema>;

export const AddTeamMemberByUserIdSchema = z.object({
    user_id: z.union([
        z.string().min(1, 'user_id is required'),
        z.array(z.string().min(1, 'each user_id is required')).min(1, 'user_id array must not be empty'),
    ]),
});

export type AddTeamMemberByUserIdInput = z.infer<typeof AddTeamMemberByUserIdSchema>;

export const RemoveTeamMemberSchema = z.object({
    user_id: z.string().min(1, 'user_id is required'),
});

export type RemoveTeamMemberInput = z.infer<typeof RemoveTeamMemberSchema>;
