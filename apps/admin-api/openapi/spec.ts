/// <reference types="zod-openapi" />

import { createDocument } from 'zod-openapi';
import { paymentsPaths } from './paths/payments';
import { organisationPaths } from './paths/organisation';
import { promoCodesPaths } from './paths/promo-codes';

export const document = createDocument({
    openapi: '3.1.0',
    info: {
        title: 'Sales Sync Admin API',
        version: '1.0.0',
        description: 'Internal API for SaleSync staff to manage clients, plans, and templates.',
    },
    servers: [
        {
            url: 'http://localhost:8081/Prod',
            description: 'Local SAM (sam local start-api)',
        },
        {
            url: 'https://admin-api.salesync.biz/Prod',
            description: 'Production',
        },
    ],
    paths: {
        ...paymentsPaths,
        ...organisationPaths,
        ...promoCodesPaths,
    },
    components: {
        securitySchemes: {
            authenticationCookie: {
                type: 'apiKey',
                in: 'cookie',
                name: 'Authentication',
                description: 'Authentication JWT cookie — checked by isAuthorize()',
            },
            identifierCookie: {
                type: 'apiKey',
                in: 'cookie',
                name: 'Identifier',
                description: 'Identifier JWT cookie — read by getUser() to resolve id, name, email',
            },
        },
    },
});
