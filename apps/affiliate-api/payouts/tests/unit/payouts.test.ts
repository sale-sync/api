import { lambdaHandler as handler } from '../../app';
import { body, event } from '../../../shared/testing/event';
import { quiet, withSamples } from '../../../shared/testing/setup';
import { MOCK_JORDAN, MOCK_PLOY } from '../../../shared/seed';

// Payouts domain: earnings in the market currency against the US$ 100 minimum, and the payout method (last 4 digits only).
const call = (method: string, path: string, o: Parameters<typeof event>[2] = {}) => handler(event(method, path, o));
beforeAll(quiet);
beforeEach(async () => {
    await withSamples();
});

it.each(['/affiliates/payouts', '/affiliates/payout-method'])('%s needs a signed-in user', async (p) => {
    expect((await call('GET', p)).statusCode).toBe(401);
});
it('sums the commissions in the market currency and checks the minimum', async () => {
    const p = body(await call('GET', '/affiliates/payouts', { user: MOCK_JORDAN }));
    expect(p).toMatchObject({ currency: 'AUD', earned: 594, paid: 0, unpaid: 594, minimumUsd: 100, reachesMinimum: true, period: 'monthly' });
    expect(p.rows).toHaveLength(4);
    const t = body(await call('GET', '/affiliates/payouts', { user: MOCK_PLOY }));
    expect(t).toMatchObject({ currency: 'THB', earned: 2376, reachesMinimum: false }); // 8% of 23,760 + 4% of 11,880, about US$ 67
});
it('keeps only the last 4 digits of a bank account, and a write is seen at once', async () => {
    const r = await call('PUT', '/affiliates/payout-method', { user: MOCK_PLOY, body: { kind: 'bank', accountName: 'Ploy C', bank: 'Kasikornbank', accountNumber: '123-4-56789-0' } });
    expect(body(r).method).toEqual({ kind: 'bank', accountName: 'Ploy C', bank: 'Kasikornbank', branch: '', last4: '7890' });
    expect(r.body).not.toContain('56789');
    expect(body(await call('GET', '/affiliates/payout-method', { user: MOCK_PLOY })).method.last4).toBe('7890');
});
it('needs a 6 digit BSB in Australia', async () => {
    const r = await call('PUT', '/affiliates/payout-method', { user: MOCK_JORDAN, body: { kind: 'bank', accountName: 'Jordan Lee', bank: 'CBA', branch: '12', accountNumber: '12345678' } });
    expect(r.statusCode).toBe(400);
});
it('switches to Stripe', async () => {
    expect(body(await call('PUT', '/affiliates/payout-method', { user: MOCK_JORDAN, body: { kind: 'stripe' } })).method).toEqual({ kind: 'stripe' });
});
it('production stores no payout method yet (403 PAYOUTS_NOT_OPEN): payouts are their own backlog', async () => {
    process.env.AFFILIATE_STAGE = 'production';
    try {
        const r = await call('PUT', '/affiliates/payout-method', { user: MOCK_JORDAN, body: { kind: 'stripe' } });
        expect(r.statusCode).toBe(403);
        expect(body(r).code).toBe('PAYOUTS_NOT_OPEN');
    } finally {
        delete process.env.AFFILIATE_STAGE;
    }
});
