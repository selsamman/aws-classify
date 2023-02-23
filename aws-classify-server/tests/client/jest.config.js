module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  globalSetup: '../server/start-offline.js',
  globalTeardown: '../server/stop-offline.js'
};
