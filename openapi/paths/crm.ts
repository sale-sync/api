import { z } from 'zod';
import { editB2BContactSchema } from '@sales-sync/shared';

const security: Array<Record<string, string[]>> = [{ bearerAuth: [] }, { organisationAuth: [] }];

const ContactSchema = z.object({
    id: z.string(),
    organisation_uuid: z.string(),
    name: z.string(),
});

const ContactItemSchema = z.object({
    id: z.string(),
    contact_id: z.string(),
    mode: z.enum(['b2b', 'b2c']),
    status: z.string(),
});

export const crmPaths = {
    '/crm': {
        get: {
            tags: ['CRM'],
            summary: 'List contacts and forms for the organisation',
            security,
            responses: {
                '200': {
                    description: 'Contact and form lists',
                    content: {
                        'application/json': {
                            schema: z.object({
                                contactList: z.array(ContactSchema),
                                formList: z.array(z.object({ id: z.string() })),
                            }),
                        },
                    },
                },
                '401': { description: 'Unauthorized' },
                '403': { description: 'No organisation context' },
            },
        },
    },
    '/crm/create-contact': {
        post: {
            tags: ['CRM'],
            summary: 'Create a contact for the organisation',
            security,
            requestBody: {
                content: {
                    'application/json': {
                        schema: z.object({
                            name: z.string().meta({ description: 'Contact display name' }),
                        }),
                    },
                },
            },
            responses: {
                '200': {
                    description: 'Contact created',
                    content: { 'application/json': { schema: ContactSchema } },
                },
                '400': { description: 'Missing parameters' },
                '401': { description: 'Unauthorized' },
                '403': { description: 'No organisation context' },
            },
        },
    },
    '/crm/contact': {
        get: {
            tags: ['CRM'],
            summary: 'Get contact items by contact ID',
            security,
            requestParams: {
                query: z.object({
                    contact_id: z.string().meta({ description: 'Contact UUID' }),
                }),
            },
            responses: {
                '200': {
                    description: 'List of contact items',
                    content: { 'application/json': { schema: z.array(ContactItemSchema) } },
                },
                '400': { description: 'Missing contact_id' },
                '401': { description: 'Unauthorized' },
                '403': { description: 'No organisation context' },
            },
        },
        post: {
            tags: ['CRM'],
            summary: 'Add a contact item (B2B or B2C)',
            security,
            requestBody: {
                content: {
                    'application/json': {
                        schema: z.object({
                            contact_id: z.string(),
                            mode: z.enum(['b2b', 'b2c']),
                        }),
                    },
                },
            },
            responses: {
                '200': {
                    description: 'Contact item added',
                    content: { 'application/json': { schema: ContactItemSchema } },
                },
                '400': { description: 'Missing contact_id' },
                '401': { description: 'Unauthorized' },
                '403': { description: 'No organisation context' },
            },
        },
        patch: {
            tags: ['CRM'],
            summary: 'Edit a B2B contact item',
            security,
            requestBody: {
                content: {
                    'application/json': { schema: editB2BContactSchema },
                },
            },
            responses: {
                '200': {
                    description: 'Contact item updated',
                    content: { 'application/json': { schema: ContactItemSchema } },
                },
                '400': { description: 'Validation error' },
                '401': { description: 'Unauthorized' },
                '403': { description: 'No organisation context' },
            },
        },
    },
    '/crm/form': {
        post: {
            tags: ['CRM'],
            summary: 'Create a form for the organisation',
            security,
            requestBody: {
                content: {
                    'application/json': {
                        schema: z.object({
                            name: z.string().meta({ description: 'Form name' }),
                        }),
                    },
                },
            },
            responses: {
                '200': {
                    description: 'Form created',
                    content: { 'application/json': { schema: z.object({ id: z.string() }) } },
                },
                '400': { description: 'Missing parameters' },
                '401': { description: 'Unauthorized' },
                '403': { description: 'No organisation context' },
            },
        },
    },
};
