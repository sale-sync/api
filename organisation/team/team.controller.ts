import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods, isAuthorize, UNAUTHORIZE_ERROR, ValidationError } from '@devyethiha/samjs';
import { OrganisationService } from '../services/organisation.service';
import { AddTeamMemberDTO } from './dtos/add-team-member.dto';

class TeamController extends Controller implements IControllerMethods {
    private organisationService: OrganisationService;

    constructor(organisationService: OrganisationService) {
        super('team');
        this.organisationService = organisationService;
    }

    // POST /organisations/team → add team member(s) by email
    async post(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        try {
            const body = new AddTeamMemberDTO().validate(JSON.parse(event.body || '{}'));
            const emails = Array.isArray(body.email) ? body.email : [body.email];
            const result = await this.organisationService.addTeamMembers(body.org_uuid, emails);
            return {
                statusCode: 201,
                body: JSON.stringify({ message: 'Team member(s) added', ...result }),
            };
        } catch (error) {
            if (error instanceof ValidationError) {
                return { statusCode: 400, body: JSON.stringify({ message: error.message, issues: error.issues }) };
            }
            throw error;
        }
    }
}

export default TeamController;
