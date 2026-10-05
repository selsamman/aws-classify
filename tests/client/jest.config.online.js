module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  globalSetup: '<rootDir>/../server/start-online.js',
  testEnvironmentOptions: {url:process.env.WebsiteURL}
};
