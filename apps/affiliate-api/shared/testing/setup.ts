// Test setup for every affiliate Lambda: a fresh in-memory DynamoDB, the table name set, and (optionally) the two sample
// affiliates written the way the affiliates Lambda writes them on first use.
import { setDocClient } from '../db';
import { findAffiliate } from '../affiliate';
import { MOCK_JORDAN, MOCK_PLOY } from '../seed';
import { useFakeDdb, type FakeDdb } from './fake-ddb';

export function freshTable(): FakeDdb {
    process.env.AFFILIATE_TABLE_NAME = 'test-affiliate';
    return useFakeDdb(setDocClient);
}
export async function withSamples(): Promise<FakeDdb> {
    const fake = freshTable();
    await findAffiliate(MOCK_JORDAN, { seedSamples: true });
    await findAffiliate(MOCK_PLOY, { seedSamples: true });
    return fake;
}
// samjs logs every request without cookies; keep the test output readable
export const quiet = () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
};
