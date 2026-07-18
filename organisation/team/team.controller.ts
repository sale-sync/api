import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods, isAuthorize, UNAUTHORIZE_ERROR, ValidationError } from '@devyethiha/samjs';
import { getOrganisation, NO_ORGANISATION } from '@sale-sync/shared';
import { InsufficientRoleError, LastOwnerError, OrganisationService, OwnerOnlyActionError } from '../services/organisation.service';
import { AddTeamMemberDTO } from './dtos/add-team-member.dto';
import { RemoveTeamMemberDTO } from './dtos/remove-team-member.dto';
import { UpdateTeamMemberRoleDTO } from './dtos/update-team-member-role.dto';

class TeamController extends Controller implements IControllerMethods {
    private organisationService: OrganisationService;

    constructor(organisationService: OrganisationService) {
        super('team');
        this.organisationService = organisationService;
    }

    // POST /organisations/team → add team member(s) by email to the organisation (from the Organisation cookie)
    async post(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        const organisation = getOrganisation(event);
        if (!organisation) return NO_ORGANISATION;

        try {
            const body = new AddTeamMemberDTO().validate(JSON.parse(event.body || '{}'));
            const emails = Array.isArray(body.email) ? body.email : [body.email];
            const result = await this.organisationService.addTeamMembers(organisation.uuid, emails, organisation.user_id);
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

    // DELETE /organisations/team → remove a team member from the organisation (from the Organisation cookie)
    async delete(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        const organisation = getOrganisation(event);
        if (!organisation) return NO_ORGANISATION;

        try {
            const body = new RemoveTeamMemberDTO().validate(JSON.parse(event.body || '{}'));
            await this.organisationService.removeTeamMember(organisation.uuid, body.user_id, organisation.user_id);
            return { statusCode: 200, body: JSON.stringify({ message: 'Team member removed' }) };
        } catch (error) {
            if (error instanceof ValidationError) {
                return { statusCode: 400, body: JSON.stringify({ message: error.message, issues: error.issues }) };
            }
            if (error instanceof InsufficientRoleError || error instanceof OwnerOnlyActionError) {
                return { statusCode: 403, body: JSON.stringify({ message: error.message }) };
            }
            if (error instanceof LastOwnerError) {
                return { statusCode: 409, body: JSON.stringify({ message: error.message }) };
            }
            throw error;
        }
    }

    // PATCH /organisations/team → update a team member's role in the organisation (from the Organisation cookie)
    async patch(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;

        const organisation = getOrganisation(event);
        if (!organisation) return NO_ORGANISATION;

        try {
            const body = new UpdateTeamMemberRoleDTO().validate(JSON.parse(event.body || '{}'));
            await this.organisationService.updateTeamMemberRole(organisation.uuid, body.user_id, body.role, organisation.user_id);
            return { statusCode: 200, body: JSON.stringify({ message: 'Team member role updated' }) };
        } catch (error) {
            if (error instanceof ValidationError) {
                return { statusCode: 400, body: JSON.stringify({ message: error.message, issues: error.issues }) };
            }
            if (error instanceof InsufficientRoleError || error instanceof OwnerOnlyActionError) {
                return { statusCode: 403, body: JSON.stringify({ message: error.message }) };
            }
            if (error instanceof LastOwnerError) {
                return { statusCode: 409, body: JSON.stringify({ message: error.message }) };
            }
            throw error;
        }
    }
}

export default TeamController;
