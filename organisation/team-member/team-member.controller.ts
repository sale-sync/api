import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods, isAuthorize, UNAUTHORIZE_ERROR, ValidationError } from '@devyethiha/samjs';
import { getOrganisation, NO_ORGANISATION } from '@sale-sync/shared';
import { InsufficientRoleError, OrganisationService } from '../services/organisation.service';
import { AddTeamMemberByUserIdDTO } from './dtos/add-team-member-by-user-id.dto';

class TeamMemberController extends Controller implements IControllerMethods {
    private organisationService: OrganisationService;

    constructor(organisationService: OrganisationService) {
        super('team-member');
        this.organisationService = organisationService;
    }

    // POST /organisations/team-member → add team member(s) by user_id (uuid) to the organisation
    // (from the Organisation cookie). For users who already have a Cognito account — e.g. resolved
    // via a prior GET /organisations/users?email= lookup — but aren't yet an org member.
    async post(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        const organisation = getOrganisation(event);
        if (!organisation) return NO_ORGANISATION;

        try {
            const body = new AddTeamMemberByUserIdDTO().validate(JSON.parse(event.body || '{}'));
            const userIds = Array.isArray(body.user_id) ? body.user_id : [body.user_id];
            const result = await this.organisationService.addTeamMembersByUserId(organisation.uuid, userIds, organisation.user_id);
            return {
                statusCode: 201,
                body: JSON.stringify({ message: 'Team member(s) added', ...result }),
            };
        } catch (error) {
            if (error instanceof ValidationError) {
                return { statusCode: 400, body: JSON.stringify({ message: error.message, issues: error.issues }) };
            }
            if (error instanceof InsufficientRoleError) {
                return { statusCode: 403, body: JSON.stringify({ message: error.message }) };
            }
            throw error;
        }
    }
}

export default TeamMemberController;
