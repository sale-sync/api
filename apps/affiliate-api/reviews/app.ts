// Affiliate API, reviews domain: GET and POST /affiliates/reviews (the team review of applications, from the team portal).
// One Lambda per resource (domain-driven, least privilege, isolation, smaller bundles). Its own sign-in: the team portal's
// Firebase token and the reviewer list (shared/reviewer.ts), never the affiliate pool.
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Router, withCORS } from '@devyethiha/samjs';
import ReviewsController from './reviews.controller';
import { ReviewService } from './review.service';
import { tooLarge } from '../shared/http';

/** The team portal calls through its Worker (server to server); these are for local dev in a browser only. */
const REVIEW_ORIGINS = ['https://team.silastech.co', 'http://localhost:3270', 'http://127.0.0.1:3270'];

async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    try {
        if (tooLarge(event.body)) return { statusCode: 413, body: JSON.stringify({ message: 'Request body is too large' }) };
        const router = new Router(event, 'ap-southeast-2', [{ controller: ReviewsController, services: [ReviewService] }], '/affiliates');
        return await router.handle();
    } catch (err) {
        console.log({ err });
        return { statusCode: 500, body: JSON.stringify({ message: 'some error happened' }) };
    }
}

export const lambdaHandler = withCORS(main, REVIEW_ORIGINS);
