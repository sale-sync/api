import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Router, withCORS } from '@devyethiha/samjs';
import DefaultController from './default/default.controller';
import ByIdController from './by-id/by-id.controller';
import SubscriptionController from './subscription/subscription.controller';
import { PlanService } from './services/plan.service';
import { SubscriptionService } from './services/subscription.service';

async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const region = 'ap-southeast-2';
    try {
        const router = new Router(
            event,
            region,
            [
                { controller: DefaultController, services: [PlanService] },
                { controller: ByIdController, services: [PlanService] },
                { controller: SubscriptionController, services: [SubscriptionService] },
            ],
            '/payments',
        );

        return await router.handle();
    } catch (err) {
        console.log({ err });
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'some error happened' }),
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
