import { IContactService } from './../contact/contact.service';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, getUser, IControllerMethods, isAuthorize, NO_USER, UNAUTHORIZE_ERROR } from '@devyethiha/samjs';
import { getOrganisation, NO_ORGANISATION } from '@sales-sync/shared';
import { IFormService } from '../form/form.service';

class DefaultController extends Controller implements IControllerMethods {
    private contactService: IContactService;
    private formService: IFormService;

    constructor(contactService: IContactService, formService: IFormService) {
        super('default');
        this.contactService = contactService;
        this.formService = formService;
    }

    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        console.log({ isAuthorize: isAuthorize(event) });

        if (!isAuthorize(event)) {
            return UNAUTHORIZE_ERROR;
        }
        const user = getUser(event);
        if (!user) {
            return NO_USER;
        }
        const organisation = getOrganisation(event);
        if (!organisation) {
            return NO_ORGANISATION;
        }
        const contactList = await this.contactService.getContacts(organisation.uuid);
        const formList = await this.formService.getForms(organisation.uuid);

        return {
            statusCode: 200,
            body: JSON.stringify({
                contactList,
                formList,
            }),
        };
    }
}

export default DefaultController;
