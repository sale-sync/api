// Affiliate API, programme domain: GET /affiliates/programme (public terms).
// One Lambda per resource (domain-driven, least privilege, isolation, smaller bundles). No table access and no table name: the terms are rules in code.
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Router, withCORS } from '@devyethiha/samjs';
import ProgrammeController from './programme.controller';
import { ProgrammeService } from './programme.service';
import { ALLOWED_ORIGINS, tooLarge } from '../shared/http';

async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    try {
        if (tooLarge(event.body)) return { statusCode: 413, body: JSON.stringify({ message: 'Request body is too large' }) };
        const router = new Router(event, 'ap-southeast-2', [{ controller: ProgrammeController, services: [ProgrammeService] }], '/affiliates');
        return await router.handle();
    } catch (err) {
        console.log({ err });
        return { statusCode: 500, body: JSON.stringify({ message: 'some error happened' }) };
    }
}

export const lambdaHandler = withCORS(main, ALLOWED_ORIGINS);
