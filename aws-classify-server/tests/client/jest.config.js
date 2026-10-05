module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  globalSetup: '<rootDir>/../server/start-offline.js',
  globalTeardown: '<rootDir>/../server/stop-offline.js'
};
