import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Router, withCORS } from '@devyethiha/samjs';
import DefaultController from './default/default.controller';
import ByIdController from './by-id/by-id.controller';
import LinkController from './link/link.controller';
import { AgentsService } from './services/agents.service';
import { OrganisationService } from '../organisation/services/organisation.service';

async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const region = 'ap-southeast-2';
    try {
        const router = new Router(
            event,
            region,
            [
                // Every controller lists both AgentsService and OrganisationService — samjs
                // instantiates each Service in a module's `services` array independently as
                // `new ServiceClass(DB_Client, db)` (it has no support for injecting one Service
                // into another's constructor), then spreads them into the Controller's constructor
                // in this same order. AgentsService's owner/admin-gated methods take the resulting
                // organisationService instance as a call parameter from the controller instead.
                { controller: DefaultController, services: [AgentsService, OrganisationService] },
                { controller: ByIdController, services: [AgentsService, OrganisationService] },
                { controller: LinkController, services: [AgentsService, OrganisationService] },
            ],
            '/agents',
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
    'https://app.salesync.biz',
    'https://staging.salesync.biz',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'https://app.salesync.local',
]);
