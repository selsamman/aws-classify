const {startOffline} = require('./offline');
module.exports = async () => {
    const offline = await startOffline({commandArgs:['--config','serverless-auth.yml'], noAuth:true});
    global.__OFFLINE__=offline; process.env.__API__=offline.api;
};
