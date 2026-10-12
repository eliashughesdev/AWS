// Unit and regression tests for the backend. A test sits beside the code it covers as
// <name>.test.ts; the e2e/**/*Test.ts scripts call a deployed stack and are not run here.
// SWC strips the types only, so `yarn test` does not type-check: `tsc -p amplify` does.
export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/amplify'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['@swc/jest', { jsc: { target: 'es2022' }, module: { type: 'commonjs' } }],
  },
  // A handler logs every request; keep the output to the test results
  silent: true,
  clearMocks: true,
  // Plain file crawling: no dependency on a local watchman install
  watchman: false,
}
