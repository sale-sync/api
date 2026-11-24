import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods } from '@devyethiha/samjs';
import { errorResponse, json, parseBody } from '../shared/http';
import { ClickService } from './click.service';
import { ClickDTO } from './dtos';

// /affiliates/clicks: called by the affiliate app's Worker when someone opens silastech.co/r/<slug>. Public on purpose, no
// sign-in: the visitor is a tradie or an agency, not an affiliate. It answers only the programme of a link (no affiliate
// data) and can only add 1 to a click counter; the Worker decides whether a click counts (a repeat or a bot does not).
class ClicksController extends Controller implements IControllerMethods {
    private clickService: ClickService;

    constructor(clickService: ClickService) {
        super('clicks');
        this.clickService = clickService;
    }

    // POST /affiliates/clicks { slug, count? } -> 200 { market } | 404 LINK_NOT_FOUND | 400 for an address that cannot be a link
    async post(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        try {
            const input = new ClickDTO().validate(parseBody(event.body));
            return json(200, await this.clickService.follow(input.slug, input.count));
        } catch (error) {
            return errorResponse(error);
        }
    }
}

export default ClicksController;
