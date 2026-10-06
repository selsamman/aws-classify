module.exports = {
    preset:'ts-jest', testEnvironment:'node',
    globalSetup:'<rootDir>/../server/start-auth-offline.js',
    globalTeardown:'<rootDir>/../server/stop-offline.js',
    testMatch:['<rootDir>/auth-offline/*.test.ts']
};
