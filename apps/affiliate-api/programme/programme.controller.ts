import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods } from '@devyethiha/samjs';
import { json } from '../shared/http';
import { ProgrammeService } from './programme.service';

// /affiliates/programme: the public terms. Public on purpose, no isAuthorize(): the landing pages show the same numbers to
// people who are not signed in. Nothing per affiliate is returned, and this Lambda has no table access at all.
class ProgrammeController extends Controller implements IControllerMethods {
    private programmeService: ProgrammeService;

    constructor(programmeService: ProgrammeService) {
        super('programme');
        this.programmeService = programmeService;
    }

    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        void event;
        return json(200, this.programmeService.terms());
    }
}

export default ProgrammeController;
