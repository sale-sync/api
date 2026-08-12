import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Router, withCORS } from '@devyethiha/samjs';
import LoginController from './login/login.controller';
import { AuthService } from './services/auth.service';

async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const region = 'ap-southeast-2';
    try {
        const router = new Router(event, region, [{ controller: LoginController, services: [AuthService] }], '/auth');

        return await router.handle();
    } catch (err) {
        console.error('admin auth handler error:', err);
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: 'some error happened',
            }),
        };
    }
}

export const lambdaHandler = withCORS(main, [
    'https://admin.salesync.biz',
    'https://staging-admin.salesync.biz',
    'https://admin.salesync.local',
    'http://localhost:3003',
    'http://127.0.0.1:3003',
]);
