import { z } from 'zod';

export const authPaths = {
    '/auth/login': {
        post: {
            tags: ['Auth'],
            summary: 'Initiate Cognito login',
            description: 'Generates a Cognito OAuth authorization URL with a nonce.',
            responses: {
                '200': {
                    description: 'Auth URL generated',
                    content: {
                        'application/json': {
                            schema: z.object({
                                authUrl: z.string().meta({ description: 'Cognito OAuth redirect URL' }),
                            }),
                        },
                    },
                },
            },
        },
        get: {
            tags: ['Auth'],
            summary: 'Cognito OAuth callback',
            description: 'Handles the Cognito OAuth callback and returns session tokens.',
            requestParams: {
                query: z.object({
                    code: z.string().meta({ description: 'Authorization code from Cognito' }),
                    state: z.string().meta({ description: 'State parameter for CSRF validation' }),
                }),
            },
            responses: {
                '200': {
                    description: 'Login successful',
                    content: {
                        'application/json': {
                            schema: z.object({
                                accessToken: z.string().optional(),
                                idToken: z.string().optional(),
                                refreshToken: z.string().optional(),
                            }),
                        },
                    },
                },
                '400': { description: 'Missing or invalid callback parameters' },
            },
        },
    },
};
