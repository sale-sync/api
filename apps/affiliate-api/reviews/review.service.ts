import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { IService, Service } from '@devyethiha/samjs';
import { findAffiliate } from '../shared/affiliate';
import { AlreadyReviewedError, NotAnAffiliateError } from '../shared/errors';
import type { Stage } from '../shared/rules';
import type { Affiliate } from '../shared/seed';
import type { DecisionInput } from './dtos';
import { listByStage, saveDecision } from './review.repository';

/** The team review: list applications by stage, read one, approve it or refuse it with a reason (shown to the applicant). */
export class ReviewService extends Service implements IService {
    constructor(DB_Client: DynamoDBClient, db: DynamoDBDocumentClient) {
        super('review');
        void DB_Client;
        void db;
    }

    list(stage: Stage): Promise<Affiliate[]> {
        return listByStage(stage);
    }

    async get(userId: string): Promise<Affiliate> {
        const a = await findAffiliate(userId);
        if (!a) throw new NotAnAffiliateError();
        return a;
    }

    async decide(reviewer: string, input: DecisionInput): Promise<Affiliate> {
        const a = await this.get(input.userId);
        if (a.stage !== 'pending') throw new AlreadyReviewedError();
        const decided: Affiliate = {
            ...a,
            stage: input.decision === 'approve' ? 'approved' : 'refused',
            reviewedOn: new Date().toISOString().slice(0, 10),
            reviewedBy: reviewer,
        };
        if (input.decision === 'refuse') decided.refusalReason = input.reason;
        else delete decided.refusalReason;
        return saveDecision(decided);
    }
}
