import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods, isAuthorize, UNAUTHORIZE_ERROR } from '@devyethiha/samjs';
import { getOrganisation, NO_ORGANISATION } from '@sale-sync/shared';
import { PUBLISH_STATUS_KEYS, PublishStatusKey } from '@sale-sync/shared/src/types';
import { getPublishStatus } from '../services/publish-status';

class PublishStatusController extends Controller implements IControllerMethods {
    constructor() {
        super('publish-status');
    }

    // GET /organisations/publish-status?page=<pageKey> — no role gate, any org member can read it.
    // Poll this after a publish POST: 'generating' until every generator that publish() invoked has
    // reported into the status item, then 'success' or 'fail' (with `reason`). No publish yet for the
    // page -> 'idle'.
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) {
            return UNAUTHORIZE_ERROR;
        }

        const organisation = getOrganisation(event);
        if (!organisation) {
            return NO_ORGANISATION;
        }

        const { page } = event.queryStringParameters ?? {};
        if (!page || !(PUBLISH_STATUS_KEYS as readonly string[]).includes(page)) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    message: `Missing or invalid query param: page (expected one of ${PUBLISH_STATUS_KEYS.join(', ')})`,
                }),
            };
        }

        const status = await getPublishStatus(organisation.uuid, page as PublishStatusKey);

        return {
            statusCode: 200,
            body: JSON.stringify(status),
        };
    }
}

export default PublishStatusController;
