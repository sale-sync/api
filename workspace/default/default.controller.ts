// import { getWorkspace } from '@sales-sync/shared';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, getUser, IControllerMethods, isAuthorize, NO_USER, UNAUTHORIZE_ERROR } from '@devyethiha/samjs';
import { IWorkspaceService } from '../services/workspace.service';

class DefaultController extends Controller implements IControllerMethods {
    private workspaceService: IWorkspaceService;

    constructor(workspaceService: IWorkspaceService) {
        super('default');
        console.log({ workspaceService });
        this.workspaceService = workspaceService;
    }

    async post(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        console.log({ isAuthorize: isAuthorize(event) });
        if (!isAuthorize(event)) {
            return UNAUTHORIZE_ERROR;
        }
        const user = getUser(event);
        if (!user) {
            return NO_USER;
        }
        const bodyStr: any = event.body;
        if (!bodyStr) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'Missing Param' }),
            };
        }
        const body = JSON.parse(bodyStr);
        const data = {
            ...body,
            user_id: user.id,
        };
        await this.workspaceService.createWorkSpace(data);
        return {
            statusCode: 200,
            body: JSON.stringify({
                msg: 'default router',
                body: {
                    ...body,
                    user_id: user.id,
                },
            }),
        };
    }

    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        console.log({ isAuthorize: isAuthorize(event) });
        console.log('=== DEBUG START ===');
        console.log('Headers:', JSON.stringify(event.headers, null, 2));
        console.log('MultiValueHeaders:', JSON.stringify(event.multiValueHeaders, null, 2));
        console.log('Raw cookie header:', event.headers?.cookie || event.headers?.Cookie || 'NO COOKIE HEADER');
        console.log('=== DEBUG END ===');
        if (!isAuthorize(event)) {
            return UNAUTHORIZE_ERROR;
        }
        const user = getUser(event);
        if (!user) {
            return NO_USER;
        }
        const data = await this.workspaceService.getWorkspacesByUserId(user.id, {
            hydrate: true,
        });
        return {
            statusCode: 200,
            body: JSON.stringify(data),
        };
    }
}

export default DefaultController;
