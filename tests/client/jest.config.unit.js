module.exports = {
  preset: 'ts-jest',
  setupFiles: ['<rootDir>/browser-globals.js'],
  testEnvironment: 'jsdom',
  testEnvironmentOptions: {customExportConditions: ['node', 'node-addons']},
  testMatch: ['<rootDir>/*.unit.test.ts'],
};
