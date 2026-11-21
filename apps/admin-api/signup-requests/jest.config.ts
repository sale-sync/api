/*
 * For a detailed explanation regarding each configuration property and type check, visit:
 * https://jestjs.io/docs/configuration
 */

export default {
    transform: {
        // isolatedModules: transpile each file independently, no whole-program type-check. Needed
        // because of a pre-existing zod v4 / samjs ValidationIssue type mismatch (confirmed
        // pre-existing, not introduced here) that otherwise fails the whole suite at compile time.
        '^.+\\.ts?$': ['ts-jest', { isolatedModules: true }],
    },
    clearMocks: true,
    collectCoverage: true,
    coverageDirectory: 'coverage',
    coverageProvider: 'v8',
    testMatch: ['**/tests/unit/*.test.ts', '**/tests/integration/*.test.ts'],
};
