import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Controller, IControllerMethods } from '@devyethiha/samjs';
import { isResponse } from '../shared/affiliate';
import { signedInReviewer } from '../shared/reviewer';
import { errorResponse, json, parseBody } from '../shared/http';
import { STAGES, type Stage } from '../shared/rules';
import { ReviewService } from './review.service';
import { DecisionDTO } from './dtos';

// /affiliates/reviews: the team review of applications, for team portal reviewers only (their Firebase sign-in, see
// shared/reviewer.ts). The affiliate's own Cognito sign-in is never accepted here.
class ReviewsController extends Controller implements IControllerMethods {
    private reviewService: ReviewService;

    constructor(reviewService: ReviewService) {
        super('reviews');
        this.reviewService = reviewService;
    }

    // GET /affiliates/reviews?stage=pending|approved|refused (default pending), or ?userId= for one application
    async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        const reviewer = await signedInReviewer(event);
        if (isResponse(reviewer)) return reviewer;
        const q = event.queryStringParameters ?? {};
        try {
            if (q.userId) return json(200, { application: await this.reviewService.get(q.userId) });
            const stage = (q.stage ?? 'pending') as Stage;
            if (!STAGES.includes(stage)) return json(400, { message: 'stage must be pending, approved or refused' });
            const lists = await Promise.all(STAGES.map((s) => this.reviewService.list(s))); // the tabs show every count
            const counts = Object.fromEntries(STAGES.map((s, i) => [s, lists[i].length]));
            return json(200, { stage, applications: lists[STAGES.indexOf(stage)], counts });
        } catch (error) {
            return errorResponse(error);
        }
    }

    // POST /affiliates/reviews { userId, decision: approve|refuse, reason? }: only a pending application; 409 ALREADY_REVIEWED otherwise
    async post(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        const reviewer = await signedInReviewer(event);
        if (isResponse(reviewer)) return reviewer;
        try {
            const input = new DecisionDTO().validate(parseBody(event.body));
            return json(200, { application: await this.reviewService.decide(reviewer.email, input) });
        } catch (error) {
            return errorResponse(error);
        }
    }
}

export default ReviewsController;
