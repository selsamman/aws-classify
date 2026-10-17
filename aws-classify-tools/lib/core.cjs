const {execFile, spawn} = require('node:child_process');
const {promisify} = require('node:util');
const {existsSync, readFileSync, readdirSync, writeFileSync} = require('node:fs');
const {createRequire} = require('node:module');
const {basename, dirname, join, relative, resolve} = require('node:path');
const {connect} = require('node:net');
const {CloudFormationClient, DescribeStacksCommand} = require('@aws-sdk/client-cloudformation');
const {CloudFrontClient, CreateInvalidationCommand} = require('@aws-sdk/client-cloudfront');
const {DynamoDBClient, CreateTableCommand, DescribeTableCommand} = require('@aws-sdk/client-dynamodb');
const {S3Client, DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand} = require('@aws-sdk/client-s3');
const {GetCallerIdentityCommand, STSClient} = require('@aws-sdk/client-sts');
const mime = require('mime-types');

const execFileAsync = promisify(execFile);
const toolRequire = createRequire(__filename);
const serverlessRun = toolRequire.resolve('serverless/run.js');
const serverlessBinary = toolRequire('serverless/binary').getBinary().binaryPath;
const localDynamoEndpoint = 'http://127.0.0.1:4567';
const toolNodeModules = dirname(dirname(toolRequire.resolve('serverless/package.json')));

function serverlessEnvironment(extra = {}) {
    const nodePath = [toolNodeModules, process.env.NODE_PATH].filter(Boolean).join(process.platform === 'win32' ? ';' : ':');
    return {...process.env, ...extra, NODE_PATH: nodePath};
}

function normalizeStage(stage) {
    if (!stage || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(stage)) throw new Error('Supply a safe --stage value.');
    return stage;
}
function configLocation(config) {
    const absolute = resolve(config);
    if (!existsSync(absolute)) throw new Error(`Serverless configuration does not exist: ${absolute}`);
    return {absolute, cwd: dirname(absolute), filename: basename(absolute)};
}
async function resolvedConfig(config, stage, environment = {}) {
    stage = normalizeStage(stage);
    const location = configLocation(config);
    const {stdout} = await execFileAsync(process.execPath, [serverlessRun, 'print', '--config', location.filename,
        '--stage', stage, '--format', 'json'], {cwd: location.cwd, env: serverlessEnvironment(environment), maxBuffer: 10 * 1024 * 1024});
    try { return {config: JSON.parse(stdout), ...location, stage}; }
    catch { throw new Error(`Serverless did not return JSON while resolving ${location.absolute}.`); }
}
async function resolvedPath(config, stage, path, environment = {}) {
    stage = normalizeStage(stage);
    const location = configLocation(config);
    const {stdout} = await execFileAsync(process.execPath, [serverlessRun, 'print', '--config', location.filename,
        '--stage', stage, '--path', path, '--format', 'json'], {cwd: location.cwd, env: serverlessEnvironment(environment), maxBuffer: 10 * 1024 * 1024});
    try { return JSON.parse(stdout); }
    catch { throw new Error(`Serverless did not return JSON for ${path}.`); }
}
function stackName(service, stage) {
    const configured = service.provider?.stackName;
    if (configured) return configured;
    if (!service.service) throw new Error('The resolved Serverless configuration has no service name.');
    return `${service.service}-${stage}`;
}
async function stackOutputs({config, stage, region}) {
    const resolved = await resolvedConfig(config, stage, {AWS_CLASSIFY_ACCOUNT_ID: process.env.AWS_CLASSIFY_ACCOUNT_ID || 'pending'});
    region ||= resolved.config.provider?.region;
    if (!region) throw new Error('The resolved Serverless configuration has no provider.region.');
    const accountId = await deployedAccountId(region);
    const deployed = await resolvedConfig(config, stage, {AWS_CLASSIFY_ACCOUNT_ID: accountId});
    const name = stackName(deployed.config, deployed.stage);
    const client = new CloudFormationClient({region});
    const {Stacks} = await client.send(new DescribeStacksCommand({StackName: name}));
    const stack = Stacks?.[0];
    if (!stack) throw new Error(`CloudFormation stack was not found: ${name}`);
    return {name, region, outputs: Object.fromEntries((stack.Outputs || []).map(item => [item.OutputKey, item.OutputValue])), resolved: deployed};
}
async function deployedAccountId(region) {
    if (process.env.AWS_CLASSIFY_ACCOUNT_ID) return process.env.AWS_CLASSIFY_ACCOUNT_ID;
    const {Account} = await new STSClient({region}).send(new GetCallerIdentityCommand({}));
    if (!Account) throw new Error('AWS did not return an account ID.');
    return Account;
}
function sourceFiles(source) {
    const directory = resolve(source);
    if (!existsSync(directory)) throw new Error(`Static source directory does not exist: ${directory}`);
    const files = readdirSync(directory, {recursive: true, withFileTypes: true})
        .filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name));
    if (!files.some(file => relative(directory, file) === 'index.html')) throw new Error(`No index.html in ${directory}; build the site first.`);
    return {directory, files};
}
async function listKeys(client, bucket) {
    const keys = []; let token;
    do {
        const page = await client.send(new ListObjectsV2Command({Bucket: bucket, ContinuationToken: token}));
        keys.push(...(page.Contents || []).map(item => item.Key)); token = page.NextContinuationToken;
    } while (token);
    return keys;
}
async function emptyBucket(bucket, {region, s3 = new S3Client({region})} = {}) {
    while (true) {
        const keys = await listKeys(s3, bucket);
        if (!keys.length) return;
        for (let start = 0; start < keys.length; start += 1000) {
            const result = await s3.send(new DeleteObjectsCommand({Bucket: bucket,
                Delete: {Objects: keys.slice(start, start + 1000).map(Key => ({Key}))}}));
            if (result.Errors?.length) throw new Error(`Could not empty ${bucket}: ${JSON.stringify(result.Errors)}`);
        }
    }
}
async function publishSite({source, bucket, distributionId, region, s3 = new S3Client({region}), cloudfront = new CloudFrontClient({region})}) {
    const {directory, files} = sourceFiles(source);
    const previous = new Set(await listKeys(s3, bucket));
    const current = new Set();
    for (const file of files) {
        const key = relative(directory, file).split('\\').join('/'); current.add(key);
        await s3.send(new PutObjectCommand({Bucket: bucket, Key: key, Body: readFileSync(file),
            ContentType: mime.lookup(file) || 'application/octet-stream',
            CacheControl: key.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'}));
    }
    const stale = [...previous].filter(key => !current.has(key));
    for (let start = 0; start < stale.length; start += 1000) {
        const result = await s3.send(new DeleteObjectsCommand({Bucket: bucket,
            Delete: {Objects: stale.slice(start, start + 1000).map(Key => ({Key}))}}));
        if (result.Errors?.length) throw new Error(`Could not remove obsolete files from ${bucket}: ${JSON.stringify(result.Errors)}`);
    }
    await cloudfront.send(new CreateInvalidationCommand({DistributionId: distributionId, InvalidationBatch: {
        CallerReference: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        Paths: {Quantity: 1, Items: ['/*']},
    }}));
    return {files: files.length, removed: stale.length};
}
function writeStackOutputs(output, outputs) {
    writeFileSync(resolve(output), JSON.stringify(outputs, null, 2) + '\n');
}
async function publishFromStack({config, stage, source, output, region}) {
    const stack = await stackOutputs({config, stage, region});
    const bucket = stack.outputs.ContentBucket;
    const distributionId = stack.outputs.CloudFrontId;
    if (!bucket || !distributionId) throw new Error(`${stack.name} must output ContentBucket and CloudFrontId.`);
    const result = await publishSite({source, bucket, distributionId, region: stack.region});
    output ||= join(stack.resolved.cwd, 'output.json');
    writeStackOutputs(output, stack.outputs);
    return {...result, ...stack, bucket, distributionId, output: resolve(output)};
}
function localDbClient() {
    return new DynamoDBClient({endpoint: localDynamoEndpoint, region: 'us-east-1', credentials: {accessKeyId: 'local', secretAccessKey: 'local'}});
}
async function initializeLocalDb({config, stage, db = localDbClient()}) {
    const properties = await resolvedPath(config, stage, 'resources.Resources.AWSClassifySessionTable.Properties', {AWS_CLASSIFY_ACCOUNT_ID: 'local'});
    const {TableName, BillingMode, AttributeDefinitions, KeySchema, GlobalSecondaryIndexes} = properties;
    if (!TableName || !KeySchema?.length) throw new Error('The resolved aws-classify session table is missing its name or key schema.');
    try { await db.send(new DescribeTableCommand({TableName})); }
    catch (error) {
        if (error.name !== 'ResourceNotFoundException') throw error;
        await db.send(new CreateTableCommand({TableName, BillingMode, AttributeDefinitions, KeySchema, GlobalSecondaryIndexes}));
    }
    for (let attempt = 0; attempt < 100; attempt++) {
        try {
            const {Table} = await db.send(new DescribeTableCommand({TableName}));
            if (Table?.TableStatus === 'ACTIVE') return TableName;
        } catch (error) { if (error.name !== 'ResourceNotFoundException') throw error; }
        await new Promise(done => setTimeout(done, 100));
    }
    throw new Error(`Timed out waiting for local session table ${TableName}.`);
}
function waitForPort(port, timeout = 30000) {
    const end = Date.now() + timeout;
    return new Promise((resolveReady, reject) => {
        const tryConnect = () => {
            const socket = connect({host: '127.0.0.1', port});
            socket.once('connect', () => { socket.destroy(); resolveReady(); });
            socket.once('error', () => {
                if (Date.now() >= end) reject(new Error(`Timed out waiting for localhost:${port}`));
                else setTimeout(tryConnect, 100);
            });
        };
        tryConnect();
    });
}
function spawnInherited(command, args, options) {
    return spawn(command, args, {...options, stdio: 'inherit'});
}
async function runOffline({config, stage, web, backendOnly = false, debug = false}) {
    const location = configLocation(config); stage = normalizeStage(stage);
    const children = []; let stopped = false;
    const stop = code => { if (stopped) return; stopped = true; for (const child of children) child.kill('SIGTERM'); process.exitCode = code; };
    const start = (name, command, args, cwd, env) => {
        const child = spawnInherited(command, args, {cwd, env}); children.push(child);
        child.on('error', error => { if (!stopped) {console.error(`${name}: ${error.message}`); stop(1);} });
        child.on('exit', code => { if (!stopped) {console.error(`${name} exited (${code})`); stop(code || 1);} });
        return child;
    };
    process.once('SIGINT', () => stop(0)); process.once('SIGTERM', () => stop(0));
    try {
        console.log('Starting Dynalite');
        start('Dynalite', process.execPath, [toolRequire.resolve('dynalite/cli.js'), '--host', '127.0.0.1', '--port', '4567'], location.cwd, process.env);
        await waitForPort(4567); await initializeLocalDb({config: location.absolute, stage});
        const env = serverlessEnvironment({DD_ENDPOINT: localDynamoEndpoint, DD_REGION: 'us-east-1', AWS_CLASSIFY_ACCOUNT_ID: 'local', AWS_ACCESS_KEY_ID: 'local', AWS_SECRET_ACCESS_KEY: 'local', AWS_SESSION_TOKEN: ''});
        if (debug) env.NODE_OPTIONS = `${env.NODE_OPTIONS || ''} --inspect=127.0.0.1:9229 --enable-source-maps`.trim();
        console.log('Starting Serverless Offline');
        start('Serverless Offline', serverlessBinary, ['offline', 'start', '--config', location.filename, '--stage', stage, '--useInProcess'], location.cwd, env);
        await Promise.all([waitForPort(4000), waitForPort(3001)]);
        if (!backendOnly) {
            if (!web) throw new Error('Supply --web <directory>, or use --backend-only.');
            const webDir = resolve(web), webRequire = createRequire(join(webDir, 'package.json'));
            const vite = resolve(dirname(webRequire.resolve('vite/package.json')), 'bin/vite.js');
            console.log('Starting Vite at http://127.0.0.1:3000');
            start('Vite', process.execPath, [vite, '--host', '127.0.0.1', '--mode', 'offline'], webDir, process.env);
            await waitForPort(3000);
        }
        console.log(backendOnly ? 'Offline backend ready' : 'Local application ready at http://127.0.0.1:3000');
    } catch (error) { console.error(error); stop(1); }
}
async function runServerless({config, stage, args}) {
    const location = configLocation(config); stage = normalizeStage(stage);
    const preview = await resolvedConfig(location.absolute, stage, {AWS_CLASSIFY_ACCOUNT_ID: process.env.AWS_CLASSIFY_ACCOUNT_ID || 'pending'});
    const accountId = await deployedAccountId(preview.config.provider?.region);
    const child = spawnInherited(serverlessBinary, [...args, '--config', location.filename, '--stage', stage], {cwd: location.cwd, env: serverlessEnvironment({AWS_CLASSIFY_ACCOUNT_ID: accountId})});
    return new Promise((resolveExit, reject) => child.once('error', reject).once('exit', code => code === 0 ? resolveExit() : reject(new Error(`Serverless exited (${code}).`))));
}
async function runExpo({project, cloudOutput, localApi, expoArgs}) {
    const directory = resolve(project), requireFromProject = createRequire(join(directory, 'package.json'));
    let apiUrl = localApi ? 'http://127.0.0.1:4000/api/dispatch' : process.env.EXPO_PUBLIC_API_URL?.trim();
    const hasEnv = existsSync(join(directory, '.env.local')) || existsSync(join(directory, '.env'));
    if (!apiUrl && !hasEnv && cloudOutput && existsSync(resolve(cloudOutput))) {
        const {WebsiteUrl} = JSON.parse(readFileSync(resolve(cloudOutput), 'utf8')); if (WebsiteUrl) apiUrl = `https://${WebsiteUrl}/api/dispatch`;
    }
    if (!apiUrl && !hasEnv) throw new Error('Set EXPO_PUBLIC_API_URL, create a mobile .env file, or deploy the cloud service first.');
    const cli = requireFromProject.resolve('expo/bin/cli');
    const child = spawnInherited(process.execPath, [cli, ...expoArgs], {cwd: directory, env: apiUrl ? {...process.env, EXPO_PUBLIC_API_URL: apiUrl} : process.env});
    return new Promise((resolveExit, reject) => child.once('error', reject).once('exit', code => code === 0 ? resolveExit() : reject(new Error(`Expo exited (${code}).`))));
}

module.exports = {emptyBucket, initializeLocalDb, localDynamoEndpoint, publishFromStack, publishSite, resolvedConfig, runExpo, runOffline, runServerless, stackName, stackOutputs, writeStackOutputs};
