/*
 * For a detailed explanation regarding each configuration property and type check, visit:
 * https://jestjs.io/docs/configuration
 */

export default {
    transform: {
        // isolatedModules: transpile each file independently, no whole-program type-check. Needed
        // here because two pre-existing bugs in item.controller.ts (calls to moveMedia/renameMedia
        // missing a required `userId` arg) fail a full type-check even though this suite doesn't
        // exercise that controller — flagged separately, not fixed as part of adding tests.
        '^.+\\.ts?$': ['ts-jest', { isolatedModules: true }],
    },
    clearMocks: true,
    collectCoverage: true,
    coverageDirectory: 'coverage',
    coverageProvider: 'v8',
    testMatch: ['**/tests/unit/*.test.ts', '**/tests/integration/*.test.ts'],
};
