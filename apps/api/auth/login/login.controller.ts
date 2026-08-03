import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods } from '@devyethiha/samjs';
import { IAuthService } from '../services/auth.service';

class LoginController extends Controller implements IControllerMethods {
    private authService: IAuthService;

    constructor(authService: IAuthService) {
        super('login');
        console.log({ authService });
        this.authService = authService;
    }

    async post(): Promise<APIGatewayProxyResult> {
        // this.authService.check();
        const authUrl = await this.authService.storeNonce();
        return {
            statusCode: 200,
            body: JSON.stringify({
                authUrl,
            }),
        };
    }

    // login callback
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        const params = event.queryStringParameters;
        if (!params) {
            return {
                statusCode: 200,
                body: JSON.stringify({
                    message: 'No param found',
                }),
            };
        }
        const result = await this.authService.cognitoCallback(params);
        if (!result)
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'Login in failure' }),
            };
        return {
            statusCode: 200,
            body: JSON.stringify({ ...result }),
        };
    }
}

export default LoginController;
