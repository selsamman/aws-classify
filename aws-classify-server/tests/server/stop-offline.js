module.exports = async function() {
    let slsOfflineProcess = global.__SERVERD__;
    //slsOfflineProcess.stdin.write('q\n');
    //slsOfflineProcess.stdin.pause();
    await slsOfflineProcess.kill('SIGINT');
    console.log('Serverless Offline stopped');
    global.__SERVERD__ = undefined;
};