import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

export type RESTFUL_API_METHOD = 'POST' | 'GET' | 'PATCH' | 'PUT' | 'DELETE';

export type ROUTE_FUNC = (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>;
