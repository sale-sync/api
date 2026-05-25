import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods } from '@devyethiha/samjs';
import { isAuthorize, getUser, UNAUTHORIZE_ERROR, NO_USER } from '@devyethiha/samjs';
import { getWorkspace, NO_WORKSPACE } from '@sales-sync/shared';
import { BlocksService } from './blocks.service';
import { CreateBlockDTO, UpdateBlockDTO, ValidateBlockDTO, validateBatchSchema } from './blocks.dto';

// ─── DTO singletons ───────────────────────────

const createBlockDTO = new CreateBlockDTO();
const updateBlockDTO = new UpdateBlockDTO();
const validateBlockDTO = new ValidateBlockDTO();

// ─────────────────────────────────────────────

export default class BlocksController extends Controller implements IControllerMethods {
    private blocksService: BlocksService;

    constructor(blocksService: BlocksService) {
        super('default');
        this.blocksService = blocksService;
    }

    // ─── Helpers ──────────────────────────────

    private ok(body: unknown, statusCode = 200): APIGatewayProxyResult {
        return { statusCode, body: JSON.stringify(body) };
    }

    private err(statusCode: number, message: string, extra?: object): APIGatewayProxyResult {
        return { statusCode, body: JSON.stringify({ error: message, ...extra }) };
    }

    private handleError(e: unknown): APIGatewayProxyResult {
        const err = e as { statusCode?: number; message?: string; errors?: unknown };
        const status = err.statusCode ?? 500;
        const message = err.message ?? 'Internal server error';
        return this.err(status, message, err.errors ? { errors: err.errors } : {});
    }

    // ─── GET /blocks
    // ─── GET /blocks?id={id}
    // ─── GET /blocks?id={id}&validate=true
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;
        const user = getUser(event);
        if (!user) return NO_USER;
        const workspace = getWorkspace(event);
        if (!workspace) return NO_WORKSPACE;

        try {
            const { id, validate } = event.queryStringParameters ?? {};
            const workspace_id = workspace.uuid;

            if (id && validate === 'true') {
                const result = await this.blocksService.validateById(workspace_id, id);
                return this.ok(result);
            }

            if (id) {
                const block = await this.blocksService.findById(workspace_id, id);
                if (!block) return this.err(404, 'Block not found');
                return this.ok(block);
            }

            const blocks = await this.blocksService.findAll(workspace_id);
            return this.ok(blocks);
        } catch (e) {
            return this.handleError(e);
        }
    }

    // ─── POST /blocks
    // ─── POST /blocks?validate=true
    // ─── POST /blocks?validate=batch
    async post(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;
        const user = getUser(event);
        if (!user) return NO_USER;
        const workspace = getWorkspace(event);
        if (!workspace) return NO_WORKSPACE;

        try {
            const { validate } = event.queryStringParameters ?? {};
            const body = JSON.parse(event.body || '{}');
            const workspace_id = workspace.uuid;

            if (validate === 'batch') {
                const parsed = validateBatchSchema.parse(body);
                const result = this.blocksService.validateMany(parsed);
                return this.ok(result, result.valid ? 200 : 422);
            }

            if (validate === 'true') {
                const parsed = validateBlockDTO.validate(body);
                const result = this.blocksService.validateOne(parsed);
                return this.ok(result, result.valid ? 200 : 422);
            }

            const parsed = createBlockDTO.validate(body);
            const block = await this.blocksService.create(workspace_id, parsed);
            return this.ok(block, 201);
        } catch (e) {
            return this.handleError(e);
        }
    }

    // ─── PUT /blocks?id={id}
    async put(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;
        const user = getUser(event);
        if (!user) return NO_USER;
        const workspace = getWorkspace(event);
        if (!workspace) return NO_WORKSPACE;

        try {
            const { id } = event.queryStringParameters ?? {};
            if (!id) return this.err(400, 'Missing query param: id');

            const body = JSON.parse(event.body || '{}');
            const parsed = updateBlockDTO.validate(body);
            const workspace_id = workspace.uuid;

            const block = await this.blocksService.update(workspace_id, id, parsed);
            return this.ok(block);
        } catch (e) {
            return this.handleError(e);
        }
    }

    // ─── DELETE /blocks?id={id}
    async delete(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;
        const user = getUser(event);
        if (!user) return NO_USER;
        const workspace = getWorkspace(event);
        if (!workspace) return NO_WORKSPACE;

        try {
            const { id } = event.queryStringParameters ?? {};
            if (!id) return this.err(400, 'Missing query param: id');

            await this.blocksService.delete(workspace.uuid, id);
            return { statusCode: 204, body: '' };
        } catch (e) {
            return this.handleError(e);
        }
    }
}
