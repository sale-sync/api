/// <reference types="zod-openapi" />

import { createDocument } from 'zod-openapi';
import { authPaths } from './paths/auth';
import { organisationPaths } from './paths/organisation';
import { crmPaths } from './paths/crm';
import { mediaPaths } from './paths/media';
import { blocksPaths } from './paths/blocks';

export const document = createDocument({
    openapi: '3.1.0',
    info: {
        title: 'Sales Sync API',
        version: '1.0.0',
        description:
            'API Gateway documentation for the Sales Sync platform. Protected routes require a Bearer JWT (from /auth/login) and an Organisation cookie.',
    },
    servers: [
        {
            url: 'http://localhost:8080/Prod',
            description: 'Local SAM (sam local start-api)',
        },
        {
            url: 'https://api.salesync.biz/Prod',
            description: 'Production',
        },
    ],
    paths: {
        ...authPaths,
        ...organisationPaths,
        ...crmPaths,
        ...mediaPaths,
        ...blocksPaths,
    },
    components: {
        securitySchemes: {
            bearerAuth: {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT',
                description: 'Access token from /auth/login callback',
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
