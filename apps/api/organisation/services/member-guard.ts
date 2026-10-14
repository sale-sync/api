import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUser, isAuthorize, NO_USER, UNAUTHORIZE_ERROR } from '@devyethiha/samjs';
import { getOrganisation, NO_ORGANISATION } from '@sale-sync/shared';
import type { OrganisationService } from './organisation.service';

export type Member = { orgUuid: string; userId: string };

const NOT_A_MEMBER: APIGatewayProxyResult = {
    statusCode: 403,
    body: JSON.stringify({ message: 'Not a member of this organisation' }),
};

// The guard chain for the Inbox and contact-form endpoints (backlogs/contact-form-mutation): signed
// in, a user, an organisation with a uuid, and a membership record for that user in that
// organisation. Returns the caller, or the response to send back instead.
//
// The membership lookup is on top of what most sibling controllers do. The Inbox returns website
// visitors' names, emails and phone numbers, and an organisation's uuid is not a secret (every client
// site sends it to queries-api), so naming an organisation in the Organisation cookie must not be
// enough on its own to read that organisation's submissions.
//
// Note this still decodes the cookies without verifying their signature, like getOrganisation() and
// getUser() everywhere else in this API. It raises the bar from "knows the org uuid" to "knows a
// member's user id for that org"; it is not a substitute for verifying the session token.
export async function resolveMember(
    event: APIGatewayProxyEvent,
    organisationService: OrganisationService,
): Promise<Member | APIGatewayProxyResult> {
    if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;
    if (!getUser(event)) return NO_USER;

    let organisation: ReturnType<typeof getOrganisation>;
    try {
        organisation = getOrganisation(event);
    } catch {
        // A malformed Organisation cookie makes the decode throw; that is "no organisation", not a 500.
        return NO_ORGANISATION;
    }
    if (!organisation?.uuid || !organisation.user_id) return NO_ORGANISATION;

    const membership = await organisationService.getMembership(organisation.uuid, organisation.user_id);
    if (!membership) return NOT_A_MEMBER;

    return { orgUuid: organisation.uuid, userId: organisation.user_id };
}

export function isResponse(value: Member | APIGatewayProxyResult): value is APIGatewayProxyResult {
    return 'statusCode' in value;
}

// JSON.parse on a request body, turning malformed JSON into a 400 instead of an unhandled 500.
export class InvalidJsonBodyError extends Error {
    constructor() {
        super('Request body must be valid JSON');
        this.name = 'InvalidJsonBodyError';
    }
}

export function parseJsonBody(event: APIGatewayProxyEvent): unknown {
    try {
        return JSON.parse(event.body || '{}');
    } catch {
        throw new InvalidJsonBodyError();
    }
}
