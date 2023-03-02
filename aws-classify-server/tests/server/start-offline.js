const { spawn } = require('child_process');

let slsOfflineProcess;

module.exports = async () => {
    console.log('Starting Serverless Offline');
    process.chdir('../server');
    await startSlsOffline().catch((e) => {
        console.error(e);
        process.chdir('../client');
        return;
    });
    global.__SERVERD__ = slsOfflineProcess;
    process.env.__API__ = 'http://localhost:4000/api/dispatch';
    process.chdir('../client');
};

function startSlsOffline() {
    slsOfflineProcess = slsOfflineProcess = spawn('sls', [ 'offline', 'start', '--stage', 'dev']);
    return finishLoading();
}

const finishLoading = () =>
    new Promise((resolve, reject) => {
        slsOfflineProcess.stdout.on('data', processLine);
        slsOfflineProcess.stderr.on('data', processLine);
        function processLine(data) {
            const line = data.toString().trim();
            console.log(line);
            if (line.includes('Offline [http for websocket] listening on')) {
                console.log(line.toString().trim());
                console.log(`Serverless Offline started with PID : ${slsOfflineProcess.pid}`);
                resolve('ok');
            }
            if (line.includes('address already in use')) {
                reject(line);
            }
            function done () {
                slsOfflineProcess.stdout.removeListener('data', processLine);
                slsOfflineProcess.stderr.removeListener('data', processLine);
            }
        }
    });