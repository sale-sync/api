// Domain errors the services throw; each controller maps them to a status code.
export class NotAnAffiliateError extends Error {
    constructor() {
        super('No affiliate account for this user yet: apply first');
        this.name = 'NotAnAffiliateError';
    }
}
export class AlreadyAppliedError extends Error {
    constructor() {
        super('This user has already applied; the market cannot be changed');
        this.name = 'AlreadyAppliedError';
    }
}
export class NotApprovedError extends Error {
    constructor(refused = false) {
        super(refused ? 'The application was not approved' : 'The application is still being reviewed');
        this.name = 'NotApprovedError';
    }
}
export class SlugTakenError extends Error {
    constructor(slug: string) {
        super(`The link address "${slug}" is already taken`);
        this.name = 'SlugTakenError';
    }
}
export class AlreadyReviewedError extends Error {
    constructor() {
        super('This application has already been reviewed');
        this.name = 'AlreadyReviewedError';
    }
}
