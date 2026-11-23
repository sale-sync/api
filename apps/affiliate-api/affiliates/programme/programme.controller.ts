import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods } from '@devyethiha/samjs';
import { ProgrammeService } from '../services/programme.service';
import { json } from '../default/http';

// /affiliates/programme: the public terms (rates, trial, payout minimum, markets). Public on purpose, no isAuthorize():
// the landing pages show the same numbers to people who are not signed in. Nothing per affiliate is returned here.
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
