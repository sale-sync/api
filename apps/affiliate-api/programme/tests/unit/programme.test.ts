import { lambdaHandler as handler } from '../../app';
import { body, event } from '../../../shared/testing/event';

// Programme domain: the public terms, with no sign-in and no table (no table name is even needed).
it('returns the rates, trial, minimum and markets without signing in or a table', async () => {
    delete process.env.AFFILIATE_TABLE_NAME;
    const r = await handler(event('GET', '/affiliates/programme'));
    expect(r.statusCode).toBe(200);
    const t = body(r);
    expect(t.plans).toEqual([
        { months: 6, rate: 0.04 },
        { months: 12, rate: 0.08 },
        { months: 24, rate: 0.16 },
    ]);
    expect(t.trialDays).toBe(14);
    expect(t.renewalsEarn).toBe(false);
    expect(t.payout).toEqual({ period: 'monthly', minimumUsd: 100, methods: ['stripe', 'bank'] });
    expect(t.markets.map((m: { market: string; currency: string }) => `${m.market}:${m.currency}`)).toEqual(['australia:AUD', 'thailand:THB']);
});
