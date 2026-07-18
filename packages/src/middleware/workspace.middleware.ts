// packages/src/middleware/workspace.middleware.ts

import { APIGatewayProxyEvent } from 'aws-lambda';
import { jwtDecode } from 'jwt-decode';

type IWorkspace = {
    workspace_id: string;
    user_id: string;
    uuid: string;
};

export const getWorkspace = (event: APIGatewayProxyEvent): IWorkspace | null => {
    const cookieHeader = event.headers?.cookie || event.headers?.Cookie;
    let workspaceCookie = null;

    if (cookieHeader) {
        const cookies = Object.fromEntries(
            cookieHeader.split(';').map((c) => {
                const [k, v] = c.trim().split('=');
                return [k, decodeURIComponent(v)];
            }),
        );

        workspaceCookie = cookies['Workspace'] || null;
        if (!workspaceCookie) return null;
        const obj = jwtDecode(workspaceCookie) as any;

        const user = {
            workspace_id: obj.workspace_id ?? '',
            user_id: obj.user_id ?? '',
            uuid: obj.uuid ?? '',
        };
        return user;
        // uid = JSON.parse(cookies['Identifier']);
    }

    return null;
};

export const NO_WORKSPACE = {
    statusCode: 404,
    body: JSON.stringify({
        message: 'Workspace not found',
    }),
};
