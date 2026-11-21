import { z } from 'zod';
import { ImageSchema } from './organisation';

export const CreateAgentSchema = z.object({
    name: z.string().min(1, 'name is required'),
    position: z.string().optional(),
    photo: ImageSchema.nullable().optional(),
    linked_user_id: z.string().nullable().optional(),
});

export type CreateAgentInput = z.infer<typeof CreateAgentSchema>;

export const UpdateAgentSchema = z
    .object({
        name: z.string().min(1).optional(),
        position: z.string().optional(),
        photo: ImageSchema.nullable().optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field (name, position, photo) must be provided',
    });

export type UpdateAgentInput = z.infer<typeof UpdateAgentSchema>;

export const LinkAgentSchema = z.object({
    agent_id: z.string().min(1, 'agent_id is required'),
    user_id: z.string().min(1, 'user_id is required').nullable(), // null = unlink
});

export type LinkAgentInput = z.infer<typeof LinkAgentSchema>;
