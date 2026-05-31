import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Router, withCORS } from '@devyethiha/samjs';
import DefaultController from './default/default.controller';
import CreateContactController from './contact/create-contact.controller';
import { ContactService } from './contact/contact.service';
import FormController from './form/form.controller';
import { FormService } from './form/form.service';
import ContactController from './contact/contact.controller';

async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const region = 'ap-southeast-2';
    try {
        const router = new Router(
            event,
            region,
            [
                { controller: DefaultController, services: [ContactService, FormService] },
                {
                    controller: CreateContactController,
                    services: [ContactService],
                },
                {
                    controller: ContactController,
                    services: [ContactService],
                },
                {
                    controller: FormController,
                    services: [FormService],
                },
            ],
            '/crm',
        );

        return await router.handle();
    } catch (error: any) {
        const statusCode = error?.statusstatusCode;
        return { statusCode: statusCode ? statusCode : 500, body: JSON.stringify(error) };
    }
}

export const lambdaHandler = withCORS(main, [
    'https://app.salesync.biz',
    'https://staging.salesync.biz',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
]);
