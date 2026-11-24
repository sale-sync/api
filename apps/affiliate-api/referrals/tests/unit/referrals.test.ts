import { lambdaHandler as handler } from '../../app';
import { body, event } from '../../../shared/testing/event';
import { quiet, withSamples } from '../../../shared/testing/setup';
import { MOCK_JORDAN, MOCK_PLOY } from '../../../shared/seed';

// Referrals domain (read only): status, trial days, commission only on subscriptions at the plan's rate, nothing private.
const call = (method: string, path: string, o: Parameters<typeof event>[2] = {}) => handler(event(method, path, o));
beforeAll(quiet);
beforeEach(async () => {
    await withSamples();
});

it('needs a signed-in user', async () => {
    expect((await call('GET', '/affiliates/referrals')).statusCode).toBe(401);
});
it('earns only on subscriptions, at the rate of the plan', async () => {
    const refs = body(await call('GET', '/affiliates/referrals', { user: MOCK_JORDAN })).referrals;
    const by = (b: string) => refs.find((r: { business: string }) => r.business === b);
    expect(by('Peak HVAC Services')).toMatchObject({ status: 'subscribed', plan: 6, rate: 0.04, commission: 23.76 });
    expect(by('Coastline Plumbing')).toMatchObject({ plan: 12, rate: 0.08, commission: 95.04 });
    expect(by('Northside Roofing')).toMatchObject({ plan: 24, rate: 0.16, commission: 380.16 });
    expect(by('Bright Spark Electrical')).toMatchObject({ status: 'trial', trialDaysLeft: 8, commission: 0 });
    expect(by('Green Edge Landscaping')).toMatchObject({ status: 'pending', commission: 0 });
    expect(by('Harbour Tiling')).toMatchObject({ status: 'ended', commission: 0 });
});
it('filters by status and refuses an unknown one', async () => {
    const refs = body(await call('GET', '/affiliates/referrals', { user: MOCK_JORDAN, query: { status: 'trial' } })).referrals;
    expect(refs.map((r: { status: string }) => r.status)).toEqual(['trial', 'trial', 'trial']);
    expect((await call('GET', '/affiliates/referrals', { user: MOCK_JORDAN, query: { status: 'paid' } })).statusCode).toBe(400);
});
it('shares only the business name, not contact details', async () => {
    const r = body(await call('GET', '/affiliates/referrals', { user: MOCK_JORDAN })).referrals[0];
    expect(Object.keys(r).sort()).toEqual(['business', 'commission', 'id', 'link', 'plan', 'rate', 'signedUp', 'status', 'subscribedOn', 'trialDaysLeft']);
});
it('an affiliate only ever sees their own referrals', async () => {
    const ploy = body(await call('GET', '/affiliates/referrals', { user: MOCK_PLOY })).referrals;
    expect(ploy.map((r: { business: string }) => r.business)).not.toContain('Coastline Plumbing');
});
