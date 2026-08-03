/// <reference types="zod-openapi" />

import { createDocument } from 'zod-openapi';
import { authPaths } from './paths/auth';
import { organisationPaths } from './paths/organisation';
import { mediaPaths } from './paths/media';
import { blocksPaths } from './paths/blocks';
import { templatePaths } from './paths/template';
import { paymentsPaths } from './paths/payments';
import { propertiesPaths } from './paths/properties';

export const document = createDocument({
    openapi: '3.1.0',
    info: {
        title: 'Sale Sync API',
        version: '1.0.0',
        description:
            'API Gateway documentation for the Sale Sync platform. Protected routes require a Bearer JWT (from /auth/login) and an Organisation cookie.',
    },
    servers: [
        {
            url: 'http://localhost:8080',
            description: 'Local SAM (sam local start-api) — staging resources by default, make start.prod for production. Note: sam local start-api ignores the StageName (Prod) and serves routes at the root, unlike the deployed API.',
        },
        {
            url: 'https://staging-api.salesync.biz',
            description: 'Staging',
        },
        {
            url: 'https://api.salesync.biz',
            description: 'Production',
        },
    ],
    paths: {
        ...authPaths,
        ...organisationPaths,
        ...mediaPaths,
        ...blocksPaths,
        ...templatePaths,
        ...paymentsPaths,
        ...propertiesPaths,
    },
    components: {
        securitySchemes: {
            bearerAuth: {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT',
                description: 'Access token from /auth/login callback',
            },
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
            organisationAuth: {
                type: 'apiKey',
                in: 'cookie',
                name: 'Organisation',
                description: 'Organisation JWT cookie set after selecting an organisation',
            },
        },
    },
});
