export default {
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.js"],
  setupFilesAfterEnv: ["<rootDir>/tests/setup.js"],
  silent: true,
  verbose: false,
  collectCoverage: false,
  testTimeout: 10000,
  transform: {
    "^.+\\.js$": "babel-jest"
  },
};