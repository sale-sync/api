import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods, isAuthorize, UNAUTHORIZE_ERROR } from '@devyethiha/samjs';

import { IContactService } from './contact.service';
import { getWorkspace, NO_WORKSPACE } from '@sales-sync/shared';
import { EditB2BContactDTO, IAddContactItemDto, IEditContactItemDto } from './contact.dto';

class ContactController extends Controller implements IControllerMethods {
    private contactService: IContactService;

    constructor(contactService: IContactService) {
        super('contact');
        this.contactService = contactService;
    }

    checkWorkspace(event: APIGatewayProxyEvent) {
        if (!isAuthorize(event)) {
            throw UNAUTHORIZE_ERROR;
        }
        const workspace = getWorkspace(event);
        if (!workspace) {
            throw NO_WORKSPACE;
        }
        return workspace;
    }

    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        this.checkWorkspace(event);
        const params: any = event.queryStringParameters || null;
        if (!params) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'Missing Param' }),
            };
        }
        const contact_id = params.contact_id;
        if (!contact_id) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'Missing contact id' }),
            };
        }

        const contact = await this.contactService.getContactItems(contact_id);
        return {
            statusCode: 200,
            body: JSON.stringify([...contact]),
        };
    }

    /**
     *
     * Add Item to  Contact
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
        const data: IAddContactItemDto = {
            workspace_uuid: workspace.uuid,
            ...body,
        };
        const contact_id = data?.contact_id;
        if (!contact_id) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'Missing contact_id' }),
            };
        }
        const contact = await this.contactService.addContactItem(data);
        return {
            statusCode: 200,
            body: JSON.stringify({
                ...contact,
            }),
        };
    }

    async patch(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        const workspace = this.checkWorkspace(event);

        const bodyStr: any = event.body;
        if (!bodyStr) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'Missing Body Content' }),
            };
        }
        const body = JSON.parse(bodyStr);
        const dto = new EditB2BContactDTO();
        dto.validate(body);
        // Refractor: need to validate data with actural dto created with zod
        const data: IEditContactItemDto = {
            workspace_uuid: workspace.uuid,
            ...body,
        };
        const contact_id = data?.contact_id;
        const id = data?.id;
        if (!contact_id) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'Missing contact_id' }),
            };
        }
        if (!id) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'Missing id' }),
            };
        }
        const updated_data = await this.contactService.editContactItem(data);
        return {
            statusCode: 200,
            body: JSON.stringify(updated_data),
        };
    }
}

export default ContactController;
