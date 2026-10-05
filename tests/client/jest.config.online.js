const api = process.env.TestAPIURL || (process.env.WebsiteURL && `${process.env.WebsiteURL.replace(/\/$/, '')}/api/dispatch`);
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  globalSetup: '<rootDir>/../server/start-online.js',
  testEnvironmentOptions: {url: api ? new URL(api).origin + '/' : 'http://localhost/'},
  testMatch: ['<rootDir>/sanity.test.ts'],
};
