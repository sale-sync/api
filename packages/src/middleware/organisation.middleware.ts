// packages/src/middleware/organisation.middleware.ts

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

export const NO_ORGANISATION = {
    statusCode: 404,
    body: JSON.stringify({
        message: 'Organisation not found',
    }),
};
