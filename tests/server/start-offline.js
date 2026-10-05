const { startOffline } = require('./offline');

module.exports = async () => {
    const offline = await startOffline();
    global.__OFFLINE__ = offline;
    process.env.__API__ = offline.api;
};
