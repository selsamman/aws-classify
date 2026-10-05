module.exports = async () => {
    await global.__OFFLINE__?.stop();
    delete global.__OFFLINE__;
    delete process.env.__API__;
};
