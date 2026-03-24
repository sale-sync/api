// middlewares/cors.ts
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const allowedOrigins = [
    'https://app.salesync.biz',
    'https://staging.salesync.biz',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
];

export function withCORS(handler: (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>) {
    return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
        const origin = event.headers?.origin || event.headers?.Origin || '';
        const allowOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];

        const baseHeaders = {
            'Access-Control-Allow-Origin': allowOrigin,
            'Access-Control-Allow-Credentials': 'true',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Requested-With',
            'Access-Control-Max-Age': '86400',
            Vary: 'Origin',
        };

        // Preflight
        if (event.httpMethod === 'OPTIONS') {
            console.log('allowed');
            return { statusCode: 204, headers: baseHeaders, body: '' };
        }

        const res = await handler(event);

        // 🟢 Ensure our headers override anything set downstream (e.g., '*' from a library)
        const cleaned = { ...(res.headers || {}) };
        delete (cleaned as any)['Access-Control-Allow-Origin'];
        delete (cleaned as any)['access-control-allow-origin'];
        delete (cleaned as any)['Access-Control-Allow-Credentials'];
        delete (cleaned as any)['access-control-allow-credentials'];

        return {
            ...res,
            headers: { ...cleaned, ...baseHeaders },
        };
    };
}
