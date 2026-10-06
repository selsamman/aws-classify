module.exports = {
  preset: 'ts-jest',
  setupFiles: ['<rootDir>/browser-globals.js'],
  testMatch: ['<rootDir>/*.test.ts'],
  testEnvironment: 'jsdom',
  testEnvironmentOptions: {customExportConditions: ['node', 'node-addons']},
  globalSetup: '<rootDir>/../server/start-offline.js',
  globalTeardown: '<rootDir>/../server/stop-offline.js'
};
