// libs/shared/src/middleware/organisation.middleware.ts

import { APIGatewayProxyEvent } from 'aws-lambda';
import { jwtDecode } from 'jwt-decode';

type IOrganisation = {
    organisation_id: string;
    user_id: string;
    uuid: string;
};

export const getOrganisation = (event: APIGatewayProxyEvent): IOrganisation | null => {
    const cookieHeader = event.headers?.cookie || event.headers?.Cookie;
    let organisationCookie = null;

    if (cookieHeader) {
        const cookies = Object.fromEntries(
            cookieHeader.split(';').map((c) => {
                const [k, v] = c.trim().split('=');
                return [k, decodeURIComponent(v)];
            }),
        );

        organisationCookie = cookies['Organisation'] || null;
        if (!organisationCookie) return null;
        const obj = jwtDecode(organisationCookie) as any;

        const user = {
            organisation_id: obj.organisation_id ?? '',
            user_id: obj.user_id ?? '',
            uuid: obj.uuid ?? '',
        };
        return user;
    }

    return null;
};

// Bearer-token equivalent of getOrganisation() above — for queries-api / any deployed
// theme-maker client site, not api/ or app/ (which keep using the Organisation cookie
// unchanged; see wello-template-api-mapping backlog for why: a client site's own domain
// (wello.com, homethailandestate.com, ...) shares no parent domain with queries-api's, so a
// cookie set on one is never sent to the other — a header the client explicitly attaches has no
// such cross-domain scoping problem). Same decode-only, no-signature-verification behavior as
// getOrganisation() — this was never a real auth boundary, only a read-scoping identifier (the
// Lambda's own IAM policy is what's actually read-only).
export const getOrganisationFromBearerToken = (event: APIGatewayProxyEvent): IOrganisation | null => {
    const authHeader = event.headers?.authorization || event.headers?.Authorization;
    if (!authHeader?.startsWith('Bearer ')) return null;

    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) return null;

    try {
        const obj = jwtDecode(token) as any;
        return {
            organisation_id: obj.organisation_id ?? '',
            user_id: obj.user_id ?? '',
            uuid: obj.uuid ?? '',
        };
    } catch {
        return null;
    }
};

export const NO_ORGANISATION = {
    statusCode: 404,
    body: JSON.stringify({
        message: 'Organisation not found',
    }),
};
