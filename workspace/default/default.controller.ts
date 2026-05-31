// workspace/default/default.controller.ts

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
    Controller,
    getUser,
    IControllerMethods,
    isAuthorize,
    NO_USER,
    UNAUTHORIZE_ERROR,
    ValidationError,
} from '@devyethiha/samjs';
import { WorkspaceAlreadyExistsError, WorkspaceService } from '../services/workspace.service';
import { CreateWorkspaceDTO } from '../dtos/create-workspace.dto';

class DefaultController extends Controller implements IControllerMethods {
    private workspaceService!: WorkspaceService;

    constructor(workspaceService: WorkspaceService) {
        super('default');
        this.workspaceService = workspaceService;
    }

    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
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

    async post(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) {
            return UNAUTHORIZE_ERROR;
        }
        const user = getUser(event);
        if (!user) {
            return NO_USER;
        }

        try {
            const dto = new CreateWorkspaceDTO();
            const body = dto.validate(JSON.parse(event.body || '{}'));

            await this.workspaceService.createWorkSpace({
                workspace_id: body.workspace_id,
                workspace_name: body.workspace_name,
                user_id: user.id,
            });

            return {
                statusCode: 201,
                body: JSON.stringify({
                    message: 'Workspace created',
                    workspace_id: body.workspace_id,
                    workspace_name: body.workspace_name,
                }),
            };
        } catch (error) {
            if (error instanceof ValidationError) {
                return {
                    statusCode: 400,
                    body: JSON.stringify({
                        message: error.message,
                        issues: error.issues,
                    }),
                };
            }
            if (error instanceof WorkspaceAlreadyExistsError) {
                return {
                    statusCode: 409,
                    body: JSON.stringify({
                        message: error.message,
                    }),
                };
            }
            throw error;
        }
    }
}

export default DefaultController;
