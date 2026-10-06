const assert = require('node:assert/strict');
const { after, test } = require('node:test');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const net = require('node:net');
const { DescribeTableCommand, DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { startOffline } = require('./offline');

const directory = mkdtempSync(join(tmpdir(), 'classify-harness-'));
const fixture = join(directory, 'serverless.cjs');
after(() => rmSync(directory, { recursive: true, force: true }));
writeFileSync(fixture, `
const net = require('node:net');
const { spawn } = require('node:child_process');
const mode = process.env.HARNESS_MODE;
if (process.argv.includes('print')) {
    if (mode === 'config-failure') { console.error('configuration broke'); process.exit(2); }
    if (mode === 'config-malformed') { console.log('{broken'); process.exit(0); }
    if (mode === 'config-incomplete') { console.log('{}'); process.exit(0); }
    if (mode === 'config-timeout') { setInterval(() => {}, 1000); }
    else console.log(JSON.stringify({
        TableName: 'classifySessionStore.test.awsclassify.com',
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: [
            { AttributeName: 'sessionId', AttributeType: 'S' },
            { AttributeName: 'userId', AttributeType: 'S' },
        ],
        KeySchema: [{ AttributeName: 'sessionId', KeyType: 'HASH' }],
        GlobalSecondaryIndexes: [{ IndexName: 'userId',
            KeySchema: [{ AttributeName: 'userId', KeyType: 'HASH' }],
            Projection: { ProjectionType: 'KEYS_ONLY' } }],
    }));
} else {
    if (mode === 'offline-failure') { console.error('offline broke'); process.exit(3); }
    const port = name => Number(process.argv[process.argv.indexOf('--' + name) + 1]);
    const listen = value => net.createServer(socket => socket.destroy()).listen(value, '127.0.0.1');
    listen(port('httpPort'));
    listen(port('websocketPort'));
    if (mode === 'stubborn') {
        process.on('SIGTERM', () => {});
        spawn(process.execPath, ['-e',
            "process.on('SIGTERM', () => {}); require('node:net').createServer(s => s.destroy()).listen(" +
                port('lambdaPort') + ", '127.0.0.1');"], { stdio: 'inherit' });
    } else if (mode !== 'partial-start') listen(port('lambdaPort'));
    // Deliberately emit no Serverless readiness message.
}
`);

async function listen(port = 0) {
    const server = net.createServer();
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
    });
    return server;
}
const close = server => new Promise(resolve => server.close(resolve));

async function freePorts() {
    const servers = await Promise.all(Array.from({ length: 4 }, () => listen()));
    const ports = Object.fromEntries(['dynamodb', 'http', 'websocket', 'lambda'].map((name, index) =>
        [name, servers[index].address().port]));
    await Promise.all(servers.map(close));
    return ports;
}

async function assertReleased(ports) {
    for (const port of Object.values(ports)) await close(await listen(port));
}

async function options(mode) {
    return {
        ports: await freePorts(), command: process.execPath, commandArgs: [fixture],
        env: { HARNESS_MODE: mode }, log: () => {}, startupTimeoutMs: 5000, shutdownTimeoutMs: 1000,
    };
}

test('starts without log matching, creates the indexed session table, stops, and restarts', async () => {
    const settings = await options('normal');
    const originalCwd = process.cwd();
    const offline = await startOffline(settings);
    try {
        assert.equal(process.cwd(), originalCwd);
        assert.equal(offline.api, `http://127.0.0.1:${settings.ports.http}/api/dispatch`);
        const client = new DynamoDBClient({
            endpoint: `http://127.0.0.1:${settings.ports.dynamodb}`, region: 'us-east-1',
            credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
        });
        try {
            const { Table } = await client.send(new DescribeTableCommand({ TableName: 'classifySessionStore.test.awsclassify.com' }));
            assert.equal(Table.TableStatus, 'ACTIVE');
            assert.equal(Table.GlobalSecondaryIndexes[0].IndexName, 'userId');
        } finally { client.destroy(); }
    } finally { await Promise.all([offline.stop(), offline.stop()]); }
    await assertReleased(settings.ports);
    const restarted = await startOffline(settings);
    await restarted.stop();
    await assertReleased(settings.ports);
});

for (const [mode, message] of [
    ['config-failure', /configuration broke/],
    ['config-malformed', /JSON/],
    ['config-incomplete', /missing its name or key schema/],
    ['config-timeout', /Timed out starting Serverless configuration/],
    ['offline-failure', /offline broke/],
    ['partial-start', /Timed out starting Serverless Offline/],
]) {
    test(`cleans up after ${mode}`, async () => {
        const settings = await options(mode);
        if (mode.includes('timeout') || mode === 'partial-start') settings.startupTimeoutMs = 1500;
        await assert.rejects(startOffline(settings), message);
        await assertReleased(settings.ports);
    });
}

test('reports a missing executable and releases DynamoDB', async () => {
    const settings = await options('normal');
    settings.command = join(directory, 'missing');
    await assert.rejects(startOffline(settings), /ENOENT/);
    await assertReleased(settings.ports);
});

test('refuses occupied ports without stopping their owner', async () => {
    const settings = await options('normal');
    const occupied = await listen(settings.ports.http);
    try {
        await assert.rejects(startOffline(settings), /unavailable.*EADDRINUSE/);
        assert.equal(occupied.listening, true);
    } finally { await close(occupied); }
    await assertReleased(settings.ports);
});

test('forces shutdown of a stubborn process and its child', { skip: process.platform === 'win32' }, async () => {
    const settings = await options('stubborn');
    settings.shutdownTimeoutMs = 200;
    const offline = await startOffline(settings);
    await offline.stop();
    await assertReleased(settings.ports);
});

test('cancels startup and cleans up services', async () => {
    const settings = await options('config-timeout');
    const controller = new AbortController();
    settings.signal = controller.signal;
    const timer = setTimeout(() => controller.abort(), 1000);
    try { await assert.rejects(startOffline(settings), { name: 'AbortError' }); }
    finally { clearTimeout(timer); }
    await assertReleased(settings.ports);
});

test('cleans up when the database process dies during startup', async () => {
    const settings = await options('normal');
    settings.databaseCommand = process.execPath;
    settings.databaseArgs = ['-e', "console.error('database broke'); process.exit(7)"];
    await assert.rejects(startOffline(settings), /Dynalite failed.*7[\s\S]*database broke/);
    await assertReleased(settings.ports);
});
