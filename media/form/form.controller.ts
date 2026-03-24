import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods, isAuthorize, UNAUTHORIZE_ERROR } from '@devyethiha/samjs';

import { getWorkspace, NO_WORKSPACE } from '@sales-sync/shared';
import { IFormService } from './form.service';
import { ICreateFormDto } from './form.dto';

class FormController extends Controller implements IControllerMethods {
    private formService: IFormService;

    constructor(formService: IFormService) {
        super('form');
        this.formService = formService;
    }

    /**
     *
     * Create Form for workspace
     * @param event
     * @returns
     */
    async post(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) {
            return UNAUTHORIZE_ERROR;
        }
        const workspace = getWorkspace(event);
        if (!workspace) {
            return NO_WORKSPACE;
        }
        const bodyStr: any = event.body;
        if (!bodyStr) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'Missing Param' }),
            };
        }
        const body = JSON.parse(bodyStr);

        // Refractor: need to validate data with actural dto created with zod
        const data: ICreateFormDto = {
            workspace_uuid: workspace.uuid,
            ...body,
        };
        const contact = await this.formService.createForm(data);
        return {
            statusCode: 200,
            body: JSON.stringify({
                ...contact,
            }),
        };
    }
}

export default FormController;
