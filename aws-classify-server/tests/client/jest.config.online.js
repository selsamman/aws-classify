module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  globalSetup: '../server/start-online.js',
  testEnvironmentOptions: {url:process.env.WebsiteURL}
};
