import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, getUser, IControllerMethods, isAuthorize, NO_USER, UNAUTHORIZE_ERROR } from '@devyethiha/samjs';
import { LinkService } from '../services/link.service';
import { LinkDTO } from '../dtos';
import { errorResponse, json, parseBody } from '../default/http';

// /affiliates/links: several links per affiliate, one per channel, each with its own results.
class LinksController extends Controller implements IControllerMethods {
    private linkService: LinkService;

    constructor(linkService: LinkService) {
        super('links');
        this.linkService = linkService;
    }

    // GET /affiliates/links
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;
        const user = getUser(event);
        if (!user?.id) return NO_USER;
        try {
            return json(200, { links: await this.linkService.list(user.id) });
        } catch (error) {
            return errorResponse(error);
        }
    }

    // POST /affiliates/links { channel, name, slug }: 403 while pending, 409 SLUG_TAKEN when the address is used
    async post(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;
        const user = getUser(event);
        if (!user?.id) return NO_USER;
        try {
            const input = new LinkDTO().validate(parseBody(event.body));
            return json(201, { link: await this.linkService.create(user.id, input) });
        } catch (error) {
            return errorResponse(error);
        }
    }
}

export default LinksController;
