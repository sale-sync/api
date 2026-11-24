import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods } from '@devyethiha/samjs';
import { isResponse, signedInUser } from '../shared/affiliate';
import { errorResponse, json, parseBody } from '../shared/http';
import { LinkService } from './link.service';
import { LinkDTO } from './dtos';

// /affiliates/links: several links per affiliate, one per channel, each with its own results.
class LinksController extends Controller implements IControllerMethods {
    private linkService: LinkService;

    constructor(linkService: LinkService) {
        super('links');
        this.linkService = linkService;
    }

    // GET /affiliates/links
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        const user = signedInUser(event); // isAuthorize + getUser
        if (isResponse(user)) return user;
        try {
            return json(200, { links: await this.linkService.list(user.id) });
        } catch (error) {
            return errorResponse(error);
        }
    }

    // POST /affiliates/links { channel, name, slug }: 403 while pending, 409 SLUG_TAKEN when the address is used
    async post(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        const user = signedInUser(event);
        if (isResponse(user)) return user;
        try {
            const input = new LinkDTO().validate(parseBody(event.body));
            return json(201, { link: await this.linkService.create(user.id, input) });
        } catch (error) {
            return errorResponse(error);
        }
    }
}

export default LinksController;
