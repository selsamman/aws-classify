const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const net = require('node:net');
const { setTimeout: delay } = require('node:timers/promises');
const { CreateTableCommand, DescribeTableCommand, DynamoDBClient } = require('@aws-sdk/client-dynamodb');

const host = '127.0.0.1';
const defaultPorts = { dynamodb: 8000, http: 4000, websocket: 3001, lambda: 3002 };

async function assertPortAvailable(port) {
    const server = net.createServer();
    await new Promise((resolve, reject) => {
        server.once('error', error => reject(new Error(`Offline port ${port} is unavailable: ${error.message}`)));
        server.listen(port, host, resolve);
    });
    await new Promise(resolve => server.close(resolve));
}

function portReady(port) {
    return new Promise(resolve => {
        const socket = net.connect({ host, port });
        const finish = ready => { socket.destroy(); resolve(ready); };
        socket.setTimeout(500, () => finish(false));
        socket.once('connect', () => finish(true));
        socket.once('error', () => finish(false));
    });
}

// A process group includes any subprocesses launched by the v4 executable.
function signalGroup(child, signal) {
    if (!child.pid) return;
    try {
        if (process.platform === 'win32') child.kill(signal);
        else process.kill(-child.pid, signal);
    } catch (error) {
        if (error.code !== 'ESRCH') throw error;
    }
}

function groupAlive(child) {
    if (!child.pid) return false;
    if (process.platform === 'win32') return child.exitCode === null && child.signalCode === null;
    try { process.kill(-child.pid, 0); return true; }
    catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}

async function stopChild(child, timeoutMs) {
    signalGroup(child, 'SIGTERM');
    const deadline = Date.now() + timeoutMs;
    while (groupAlive(child) && Date.now() < deadline) await delay(50);
    if (groupAlive(child)) signalGroup(child, 'SIGKILL');
    const forcedDeadline = Date.now() + 2000;
    while (groupAlive(child) && Date.now() < forcedDeadline) await delay(50);
    if (groupAlive(child)) throw new Error(`Could not stop the process group for ${child.label}`);
    // Wait for the process and its output streams to close, not kill()'s boolean result.
    let timer;
    try {
        await Promise.race([child.closed, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Could not stop ${child.label}`)), 2000);
        })]);
    } finally { clearTimeout(timer); }
}

async function startOffline(options = {}) {
    const ports = { ...defaultPorts, ...options.ports };
    const startupTimeoutMs = options.startupTimeoutMs ?? 60000;
    const shutdownTimeoutMs = options.shutdownTimeoutMs ?? 5000;
    const log = options.log ?? console.log;
    const children = [];
    let stopping;
    let dbClient;
    const forceCleanup = () => children.forEach(child => signalGroup(child, 'SIGKILL'));
    const stop = () => {
        if (stopping) return stopping;
        stopping = (async () => {
            const failures = [];
            // Keep the database alive while the HTTP/WebSocket services finish.
            for (const child of [...children].reverse()) {
                try { await stopChild(child, shutdownTimeoutMs); }
                catch (error) { failures.push(error); }
            }
            dbClient?.destroy();
            process.removeListener('exit', forceCleanup);
            if (failures.length) throw new AggregateError(failures, 'Offline shutdown failed');
        })();
        return stopping;
    };

    function launch(label, command, args, env, quiet = false) {
        const child = spawn(command, args, {
            cwd: __dirname, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
        });
        child.label = label;
        child.output = '';
        child.stdoutText = '';
        child.closed = new Promise(resolve => child.once('close', () => {
            child.didClose = true;
            resolve();
        }));
        child.on('error', error => { child.failure = error; });
        child.stdout.on('data', data => {
            if (quiet) child.stdoutText += data;
            capture(data);
        });
        child.stderr.on('data', capture);
        function capture(data) {
            child.output = (child.output + data).slice(-16000);
            if (!quiet) log(data.toString().trimEnd());
        }
        children.push(child);
        return child;
    }

    const deadline = Date.now() + startupTimeoutMs;
    function check(child, allowSuccessfulExit = false) {
        options.signal?.throwIfAborted();
        const failedDatabase = children.find(process => process.label === 'Dynalite' &&
            (process.failure || process.exitCode !== null || process.signalCode !== null));
        if (failedDatabase) child = failedDatabase;
        if (child.failure || (child.exitCode !== null && !(allowSuccessfulExit && child.exitCode === 0)) || child.signalCode !== null) {
            throw new Error(`${child.label} failed (${child.failure?.message || child.signalCode || child.exitCode})\n${child.output}`);
        }
        if (Date.now() >= deadline) throw new Error(`Timed out starting ${child.label} after ${startupTimeoutMs}ms\n${child.output}`);
    }
    async function waitForPorts(child, required) {
        while (true) {
            check(child);
            if ((await Promise.all(required.map(portReady))).every(Boolean)) return;
            await delay(100);
        }
    }

    try {
        // Refuse to attach to or stop a service belonging to another run.
        for (const port of Object.values(ports)) await assertPortAvailable(port);
        let command = options.command;
        if (!command) {
            command = require('serverless/binary').getBinary().binaryPath;
            if (!existsSync(command)) throw new Error('Serverless v4 executable is missing; run npm run install:tests from the repository root');
        }
        const commandArgs = options.commandArgs ?? [];
        const env = {
            ...process.env,
            DD_ENDPOINT: `http://${host}:${ports.dynamodb}`,
            DD_REGION: 'us-east-1',
            AWS_REGION: 'us-east-1',
            AWS_ACCESS_KEY_ID: 'local',
            AWS_SECRET_ACCESS_KEY: 'local',
            AWS_SESSION_TOKEN: '',
            AWS_EC2_METADATA_DISABLED: 'true',
            ...options.env,
        };
        process.on('exit', forceCleanup);
        const database = launch('Dynalite', process.execPath, [require.resolve('dynalite/cli.js'),
            '--host', host, '--port', String(ports.dynamodb)], env);
        await waitForPorts(database, [ports.dynamodb]);

        // Resolve the real shared CloudFormation schema, including the userId index.
        const config = launch('Serverless configuration', command, [...commandArgs,
            'print', '--stage', 'dev', '--path', 'resources.Resources.AWSClassifySessionTable.Properties',
            '--format', 'json'], env, true);
        while (!config.didClose) {
            check(config, true);
            await delay(100);
        }
        check(config, true);
        // The completed command owns no live group; do not retain its old PID.
        if (!groupAlive(config)) children.splice(children.indexOf(config), 1);
        const { TableName, BillingMode, AttributeDefinitions, KeySchema, GlobalSecondaryIndexes } = JSON.parse(config.stdoutText);
        if (!TableName || !KeySchema?.length) throw new Error('The resolved session table is missing its name or key schema');
        dbClient = new DynamoDBClient({
            endpoint: env.DD_ENDPOINT, region: env.DD_REGION,
            credentials: { accessKeyId: 'local', secretAccessKey: 'local' }, maxAttempts: 1,
        });
        const send = command => dbClient.send(command, {
            abortSignal: AbortSignal.any([AbortSignal.timeout(Math.max(1, deadline - Date.now())),
                ...(options.signal ? [options.signal] : [])]),
        });
        await send(new CreateTableCommand({ TableName, BillingMode, AttributeDefinitions, KeySchema, GlobalSecondaryIndexes }));
        while (true) {
            check(database);
            const { Table } = await send(new DescribeTableCommand({ TableName }));
            if (Table?.TableStatus === 'ACTIVE' && (Table.GlobalSecondaryIndexes || []).every(index => index.IndexStatus === 'ACTIVE')) break;
            await delay(100);
        }
        log(`Local session table ready: ${TableName}`);
        if (options.debug) env.NODE_OPTIONS = `${env.NODE_OPTIONS || ''} --inspect=127.0.0.1:9229 --enable-source-maps`.trim();
        const offline = launch('Serverless Offline', command, [...commandArgs, 'offline', 'start', '--stage', 'dev',
            '--httpPort', String(ports.http), '--websocketPort', String(ports.websocket), '--lambdaPort', String(ports.lambda)], env);
        await waitForPorts(offline, [ports.http, ports.websocket, ports.lambda]);
        log('Offline HTTP, WebSocket, and DynamoDB services ready');
        return { stop, api: `http://${host}:${ports.http}/api/dispatch` };
    } catch (error) {
        try { await stop(); }
        catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Offline startup and cleanup failed'); }
        throw error;
    }
}

module.exports = { startOffline };

if (require.main === module) {
    let offline;
    const controller = new AbortController();
    const stop = () => {
        controller.abort();
        offline?.stop().catch(error => { console.error(error); process.exitCode = 1; });
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    startOffline({ debug: process.argv.includes('--debug'), signal: controller.signal }).then(async instance => {
        offline = instance;
        if (controller.signal.aborted) await instance.stop();
    }).catch(error => {
        if (error.name !== 'AbortError') { console.error(error); process.exitCode = 1; }
    });
}
