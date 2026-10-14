import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods, ValidationError } from '@devyethiha/samjs';
import { InsufficientRoleError, OrganisationService } from '../services/organisation.service';
import { InvalidJsonBodyError, isResponse, parseJsonBody, resolveMember } from '../services/member-guard';
import { InboxService, SubmissionNotFoundError } from '../services/inbox.service';
import { ContactSubmissionIdQueryDTO, ListContactSubmissionsQueryDTO, UpdateContactSubmissionDTO } from './inbox.dto';

// Every handler starts with resolveMember() (services/member-guard.ts): signed in, and a member of the
// organisation in their session. The organisation never comes from the query string or body, and
// every InboxService call is keyed by it: a member of one organisation can only ever list, read, mark
// or delete that organisation's submissions.
class InboxController extends Controller implements IControllerMethods {
    private organisationService: OrganisationService;
    private inboxService: InboxService;

    constructor(organisationService: OrganisationService, inboxService: InboxService) {
        super('inbox');
        this.organisationService = organisationService;
        this.inboxService = inboxService;
    }

    // GET /organisations/inbox?limit=&cursor=&q= — the org's submissions, newest first. `cursor` is
    // the `next_cursor` of the previous page; `q` is a free-text search over the submitted values.
    // GET /organisations/inbox?summary=true — just `{ unread }`, for the menu's unread count.
    // No role gate beyond membership: any org member can read the inbox.
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        const member = await resolveMember(event, this.organisationService);
        if (isResponse(member)) return member;

        try {
            const { summary, limit, cursor, q } = event.queryStringParameters ?? {};

            if (summary === 'true') {
                const unread = await this.inboxService.countUnread(member.orgUuid);
                return { statusCode: 200, body: JSON.stringify({ unread }) };
            }

            const query = new ListContactSubmissionsQueryDTO().validate({ limit, cursor, q: q || undefined });
            const list = await this.inboxService.list(member.orgUuid, query);

            return { statusCode: 200, body: JSON.stringify(list) };
        } catch (error) {
            return this.handleError(error);
        }
    }

    // PATCH /organisations/inbox?id={id} — body { read: boolean }. No role gate: opening a
    // submission marks it read, and any member can open one.
    async patch(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        const member = await resolveMember(event, this.organisationService);
        if (isResponse(member)) return member;

        try {
            const { id } = new ContactSubmissionIdQueryDTO().validate({ id: event.queryStringParameters?.id });
            const body = new UpdateContactSubmissionDTO().validate(parseJsonBody(event));
            const updated = await this.inboxService.setRead(member.orgUuid, id, body.read);

            return { statusCode: 200, body: JSON.stringify(updated) };
        } catch (error) {
            return this.handleError(error);
        }
    }

    // DELETE /organisations/inbox?id={id} — permanent. Restricted to owner/admin.
    async delete(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        const member = await resolveMember(event, this.organisationService);
        if (isResponse(member)) return member;

        try {
            await this.organisationService.assertCanManageTeam(member.orgUuid, member.userId);

            const { id } = new ContactSubmissionIdQueryDTO().validate({ id: event.queryStringParameters?.id });
            await this.inboxService.delete(member.orgUuid, id);

            return { statusCode: 204, body: '' };
        } catch (error) {
            return this.handleError(error);
        }
    }

    private handleError(error: unknown): APIGatewayProxyResult {
        if (error instanceof InvalidJsonBodyError) {
            return { statusCode: 400, body: JSON.stringify({ message: error.message }) };
        }
        if (error instanceof ValidationError) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: error.message, issues: error.issues }),
            };
        }
        if (error instanceof InsufficientRoleError) {
            return { statusCode: 403, body: JSON.stringify({ message: error.message }) };
        }
        if (error instanceof SubmissionNotFoundError) {
            return { statusCode: 404, body: JSON.stringify({ message: error.message }) };
        }
        throw error;
    }
}

export default InboxController;
