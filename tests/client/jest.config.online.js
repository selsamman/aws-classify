const api = process.env.TestAPIURL || (process.env.WebsiteURL && `${process.env.WebsiteURL.replace(/\/$/, '')}/api/dispatch`);
module.exports = {
  preset: 'ts-jest',
  setupFiles: ['<rootDir>/browser-globals.js'],
  testEnvironment: 'jsdom',
  globalSetup: '<rootDir>/../server/start-online.js',
  testEnvironmentOptions: {customExportConditions: ['node', 'node-addons'], url: api ? new URL(api).origin + '/' : 'http://localhost/'},
  testMatch: ['<rootDir>/sanity.test.ts'],
};
