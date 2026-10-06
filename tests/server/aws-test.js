// A disposable fixture only. This runner never calls the offline credential setup.
const {spawn, execFileSync} = require('node:child_process');
const {mkdirSync, writeFileSync, appendFileSync, readFileSync, readdirSync, existsSync, cpSync, copyFileSync, symlinkSync} = require('node:fs');
const {resolve, join} = require('node:path');
const {randomBytes, createHash} = require('node:crypto');
const {parseArgs} = require('node:util');
const {setTimeout: delay} = require('node:timers/promises');
const {STSClient, GetCallerIdentityCommand} = require('@aws-sdk/client-sts');
const {CloudFormationClient, DescribeStacksCommand, DescribeStackEventsCommand, ListStackResourcesCommand, DeleteStackCommand} = require('@aws-sdk/client-cloudformation');
const {S3Client, CreateBucketCommand, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand, DeleteBucketCommand} = require('@aws-sdk/client-s3');
const {CloudFrontClient, GetDistributionCommand} = require('@aws-sdk/client-cloudfront');
const {CloudWatchLogsClient, FilterLogEventsCommand} = require('@aws-sdk/client-cloudwatch-logs');
const {DynamoDBClient, DescribeTimeToLiveCommand, ScanCommand} = require('@aws-sdk/client-dynamodb');

async function describeActiveStack(client, stackId) {
    try {
        const current = (await client.send(new DescribeStacksCommand({StackName: stackId}))).Stacks?.[0];
        // AWS retains deleted stack metadata when queried by ARN.
        return current?.StackStatus === 'DELETE_COMPLETE' ? undefined : current;
    } catch (error) {
        if (error.name === 'ValidationError' && /does not exist/.test(error.message)) return undefined;
        throw error;
    }
}
function validateCleanupManifest(prior, identity, region) {
    if (identity.Account !== prior.account) throw new Error('Cleanup account does not match the recorded account');
    const service = prior.service;
    const stackName = `${service}-dev`;
    if (prior.stackName !== stackName || !/^aws-classify-tests-[a-z0-9-]+$/.test(service) || prior.region !== region || prior.contentBucket !== `${service}-${identity.Account}` || prior.deploymentBucket !== `${service}-d-${identity.Account}`) throw new Error('Cleanup manifest does not describe this runner’s isolated fixture');
    if (prior.stackId && !prior.stackId.startsWith(`arn:aws:cloudformation:${region}:${identity.Account}:stack/${stackName}/`)) throw new Error('Cleanup stack identifier does not match the fixture');
}

function captureRevision(root, directory, label) {
    const git = args => execFileSync('git', args, {cwd: root, encoding: 'utf8'});
    const diff = git(['diff', 'HEAD']);
    writeFileSync(join(directory, `${label}-changes.patch`), diff);
    const files = new Set(git(['ls-files', '-co', '--exclude-standard']).trim().split('\n').filter(file =>
        (/^(aws-classify-(client|server|common)|tests)\/.*\.(ts|js|json|yml)$/.test(file) || /^package(-lock)?\.json$/.test(file)) && existsSync(join(root, file))));
    // Include built code consumed directly by Jest, even though lib/ is ignored.
    for (const library of ['client', 'server', 'common']) {
        const dir = `aws-classify-${library}/lib/cjs`;
        for (const file of readdirSync(join(root, dir))) if (file.endsWith('.js')) files.add(`${dir}/${file}`);
    }
    const hashes = Object.fromEntries([...files].sort().map(file => [file, createHash('sha256').update(readFileSync(join(root, file))).digest('hex')]));
    return {commit: git(['rev-parse', 'HEAD']).trim(), workingTree: git(['status', '--short']).trim(), diffSha256: createHash('sha256').update(diff).digest('hex'), sourceSha256: hashes};
}

function prepareFixture(reportDir) {
    const root = resolve(__dirname, '../..');
    const fixture = join(reportDir, 'fixture');
    mkdirSync(fixture, {recursive:true});
    cpSync(join(__dirname, 'src'), join(fixture, 'src'), {recursive:true});
    cpSync(join(__dirname, 'static'), join(fixture, 'static'), {recursive:true});
    // Keep fixture function names below AWS's limit even with the longest supported prefix.
    for (const file of ['functions.yml','functions-authenticated.yml']) {
        let functions = readFileSync(join(root,'aws-classify-server/yml',file),'utf8');
        const names = {responseHandler:'http',publicResponseHandler:'public',connectHandler:'connect',disconnectHandler:'disconnect'};
        functions = functions.replace(/^  name:.*\n/gm,'');
        for (const [key,name] of Object.entries(names)) functions = functions.replace(`${key}:\n`, `${key}:\n  name: \${self:service}-\${sls:stage}-${name}\n`);
        writeFileSync(join(fixture, `fixture-${file}`), functions);
    }
    for (const file of ['serverless.yml', 'serverless-auth.yml']) {
        const config = readFileSync(join(__dirname, file), 'utf8').replace('../../aws-classify-server/yml', join(root, 'aws-classify-server/yml')).replace('${self:custom.yml}/functions.yml','fixture-functions.yml').replace('${self:custom.yml}/functions-authenticated.yml','fixture-functions-authenticated.yml');
        writeFileSync(join(fixture, file), config);
    }
    for (const file of ['package.json', 'tsconfig.json', 'auth-resources.yml']) copyFileSync(join(__dirname, file), join(fixture, file));
    symlinkSync(join(root, 'node_modules'), join(fixture, 'node_modules'), 'dir');
    return fixture;
}

async function main() {
    const {values} = parseArgs({options: {
        auth: {type: 'boolean'}, suffix: {type: 'string'}, region: {type: 'string'}, profile: {type: 'string'}, cleanup: {type: 'string'},
    }});
    if (values.profile) process.env.AWS_PROFILE = values.profile;
    const prior = values.cleanup && JSON.parse(readFileSync(resolve(values.cleanup), 'utf8'));
    const region = values.region || prior?.region || process.env.AWS_REGION || 'us-east-1';
    if (prior?.profile && !values.profile) process.env.AWS_PROFILE = prior.profile;
    const prefix = values.suffix || '';
    if (prefix && !/^[a-z][a-z0-9-]{0,9}$/.test(prefix)) throw new Error('--suffix must be 1–10 lowercase letters, digits or hyphens, starting with a letter');
    const suffix = `${prefix ? prefix + '-' : ''}${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
    const service = prior?.service || `aws-classify-tests-${suffix}`;
    const stackName = `${service}-dev`;
    const reportDir = prior ? resolve(values.cleanup, '..') : resolve(__dirname, '../../.test-results/aws', service);
    mkdirSync(reportDir, {recursive: true});
    const reportFile = join(reportDir, 'run.json');
    const log = message => { console.log(message); appendFileSync(join(reportDir, 'runner.log'), message + '\n'); };
    const config = {region, maxAttempts: 3};
    const sts = new STSClient(config), cf = new CloudFormationClient(config), s3 = new S3Client(config);
    const cdn = new CloudFrontClient(config), logs = new CloudWatchLogsClient(config), db = new DynamoDBClient(config);
    const report = prior || {service, suffix, stackName, region, profile: process.env.AWS_PROFILE || null, startedAt: new Date().toISOString(), checks: {}};
    const save = () => writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
    function recordRevision(label) {
        report.revisions ||= {};
        report.revisions[label] = captureRevision(resolve(__dirname, '../..'), reportDir, label);
        save();
    }
    const controller = new AbortController();
    const interrupt = () => controller.abort(new Error('AWS test interrupted; cleaning up owned resources'));
    process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
    let failure;
    let authorized = false;
    const stack = () => describeActiveStack(cf, report.stackId || stackName);
    async function command(label, binary, args, cwd, extraEnv = {}, timeoutMs = 30 * 60 * 1000) {
        controller.signal.throwIfAborted();
        log(`${label}…`);
        const file = join(reportDir, `${label}.log`);
        await new Promise((resolvePromise, reject) => {
            const child = spawn(binary, args, {cwd, env: {...process.env, ...extraEnv}, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32'});
            let forced, error;
            const stop = reason => {
                error = reason;
                const signal = value => {
                    try { if (process.platform === 'win32') child.kill(value); else process.kill(-child.pid, value); }
                    catch (e) { if (e.code !== 'ESRCH') error = e; }
                };
                signal('SIGTERM'); forced = setTimeout(() => signal('SIGKILL'), 5000);
            };
            const abort = () => stop(controller.signal.reason);
            const timer = setTimeout(() => stop(new Error(`${label} timed out`)), timeoutMs);
            controller.signal.addEventListener('abort', abort, {once: true});
            const output = data => { appendFileSync(file, data); process.stdout.write(data); };
            child.stdout.on('data', output); child.stderr.on('data', output);
            child.on('error', e => { error = e; });
            child.once('close', code => {
                clearTimeout(timer); clearTimeout(forced); controller.signal.removeEventListener('abort', abort);
                if (error || code !== 0) reject(error || new Error(`${label} failed with exit code ${code}; see ${file}`));
                else resolvePromise();
            });
        });
    }
    async function emptyBucket(bucket) {
        // Buckets are newly created without versioning; never empty a shared bucket.
        while (true) {
            const page = await s3.send(new ListObjectsV2Command({Bucket: bucket}));
            if (!page.Contents?.length) break;
            const result = await s3.send(new DeleteObjectsCommand({Bucket: bucket, Delete: {Objects: page.Contents.map(item => ({Key: item.Key}))}}));
            if (result.Errors?.length) throw new Error(`Could not empty ${bucket}: ${JSON.stringify(result.Errors)}`);
        }
    }
    async function diagnostics() {
        if (!report.stackOwned) return;
        const current = await stack();
        if (!current) return;
        report.stackId = current.StackId;
        const events = await cf.send(new DescribeStackEventsCommand({StackName: report.stackId}));
        writeFileSync(join(reportDir, 'stack-events.json'), JSON.stringify(events.StackEvents, null, 2));
        const resources = await cf.send(new ListStackResourcesCommand({StackName: report.stackId}));
        writeFileSync(join(reportDir, 'resources.json'), JSON.stringify(resources.StackResourceSummaries, null, 2));
        // The fixture has three Lambda log groups, each containing only synthetic test data.
        for (const resource of resources.StackResourceSummaries || []) {
            if (resource.ResourceType !== 'AWS::Lambda::Function' || !resource.PhysicalResourceId) continue;
            try {
                const result = await logs.send(new FilterLogEventsCommand({logGroupName: `/aws/lambda/${resource.PhysicalResourceId}`, startTime: Date.parse(report.startedAt), limit: 1000}));
                writeFileSync(join(reportDir, `${resource.LogicalResourceId}-logs.json`), JSON.stringify(result.events, null, 2));
            } catch (e) { log(`Lambda diagnostics unavailable: ${e.name}: ${e.message}`); }
        }
        save();
    }
    async function cleanup() {
        const errors = [];
        log(`Cleaning up ${stackName}…`);
        if (report.stackOwned) {
            try {
                const current = await stack();
                if (current) {
                    report.stackId = current.StackId; save();
                    try { await emptyBucket(report.contentBucket); }
                    catch (e) { if (e.name !== 'NoSuchBucket') throw e; }
                    if (current.StackStatus !== 'DELETE_IN_PROGRESS') await cf.send(new DeleteStackCommand({StackName: report.stackId}));
                    const deadline = Date.now() + 30 * 60 * 1000;
                    let lastProgress = 0;
                    while (await stack()) {
                        const current = await stack();
                        if (current?.StackStatus === 'DELETE_FAILED') throw new Error('CloudFormation deletion failed; inspect stack-events.json');
                        if (Date.now() >= deadline) throw new Error('Timed out waiting for stack deletion');
                        if (Date.now() - lastProgress > 60000) { log(`Waiting for stack deletion (${current?.StackStatus})…`); lastProgress = Date.now(); }
                        await delay(10000);
                    }
                }
                report.stackDeleted = true;
            } catch (e) { errors.push(e); }
        }
        if (report.deploymentBucketOwned && (!report.stackOwned || report.stackDeleted)) {
            try {
                await emptyBucket(report.deploymentBucket);
                await s3.send(new DeleteBucketCommand({Bucket: report.deploymentBucket}));
                report.deploymentBucketDeleted = true;
            } catch (e) {
                if (e.name === 'NoSuchBucket') report.deploymentBucketDeleted = true;
                else errors.push(e);
            }
        }
        report.cleanup = errors.length ? 'failed' : 'passed'; save();
        if (errors.length) throw new AggregateError(errors, `Cleanup failed. Recover with: npm run test:aws -- --cleanup ${reportFile}`);
        log('Owned stack and deployment bucket removed.');
    }
    try {
        const identity = await sts.send(new GetCallerIdentityCommand({}));
        if (prior) validateCleanupManifest(prior, identity, region);
        authorized = true;
        report.account = identity.Account; report.identity = identity.Arn;
        report.contentBucket = `${service}-${identity.Account}`;
        report.deploymentBucket = `${service}-d-${identity.Account}`;
        save();
        log(`AWS identity: ${identity.Arn}; region: ${region}; stack: ${stackName}`);
        if (!prior) {
            if (await stack()) throw new Error(`Refusing to reuse existing stack ${stackName}`);
            recordRevision('package');
            controller.signal.throwIfAborted();
            await s3.send(new CreateBucketCommand({Bucket: report.deploymentBucket, ...(region === 'us-east-1' ? {} : {CreateBucketConfiguration: {LocationConstraint: region}})}));
            report.deploymentBucketOwned = true; save();
            const fixtureDir = prepareFixture(reportDir);
            const binary = require('serverless/binary').getBinary().binaryPath;
            const args = [...(values.auth ? ['--config', 'serverless-auth.yml'] : []), '--stage', 'dev', '--region', region, `--param=suffix=${suffix}`, `--param=contentBucket=${report.contentBucket}`, `--param=deploymentBucket=${report.deploymentBucket}`, ...(values.auth ? [`--param=authDomain=classify-fixture-${createHash('sha256').update(service).digest('hex').slice(0,24)}`] : []), ...(process.env.AWS_PROFILE ? ['--aws-profile', process.env.AWS_PROFILE] : [])];
            const packageDir = join(reportDir, 'package');
            await command('package', binary, ['package', ...args, '--package', packageDir], fixtureDir);
            const template = JSON.parse(readFileSync(join(packageDir, 'cloudformation-template-update-stack.json'), 'utf8'));
            const statements = Object.values(template.Resources).filter(r => r.Type === 'AWS::IAM::Role').flatMap(r => r.Properties.Policies || []).flatMap(p => p.PolicyDocument.Statement);
            for (const action of ['dynamodb:DeleteItem', 'execute-api:ManageConnections']) {
                if (!statements.some(s => [].concat(s.Action || []).includes(action))) throw new Error(`Generated IAM is missing ${action}`);
            }
            report.checks.generatedIam = 'passed';
            report.stackOwned = true; save(); // absent before our deploy; partial creation also belongs to this run
            await command('deploy', binary, ['deploy', ...args, '--package', packageDir], fixtureDir);
            const deployed = await stack();
            if (deployed?.StackStatus !== 'CREATE_COMPLETE' && deployed?.StackStatus !== 'UPDATE_COMPLETE') throw new Error(`Stack not ready: ${deployed?.StackStatus}`);
            report.stackId = deployed.StackId;
            report.outputs = Object.fromEntries(deployed.Outputs.map(o => [o.OutputKey, o.OutputValue])); save();
            const {TestApiUrl, TestWebSocketUrl, TestContentBucket, TestSessionTable, WebsiteUrl, CloudFrontId} = report.outputs;
            if (!TestApiUrl || !TestWebSocketUrl || TestContentBucket !== report.contentBucket || TestSessionTable !== `classifySessionStore.${service}` || !WebsiteUrl || !CloudFrontId) throw new Error('Unexpected fixture resource outputs');
            const distribution = await cdn.send(new GetDistributionCommand({Id: CloudFrontId}));
            if (distribution.Distribution.Status !== 'Deployed') throw new Error('CloudFront distribution is not ready');
            const body = readFileSync(join(__dirname, 'static/index.html'), 'utf8');
            await s3.send(new PutObjectCommand({Bucket: report.contentBucket, Key: 'index.html', Body: body, ContentType: 'text/html', CacheControl: 'no-cache'}));
            const website = `https://${WebsiteUrl}`;
            const deadline = Date.now() + 5 * 60 * 1000;
            while (true) {
                controller.signal.throwIfAborted();
                try {
                    const response = await fetch(`${website}/?run=${suffix}`, {signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)])});
                    if (response.ok && (await response.text()) === body) break;
                } catch (e) { if (controller.signal.aborted) throw e; }
                if (Date.now() >= deadline) throw new Error('Uploaded static fixture was not served by CloudFront');
                await delay(2000);
            }
            if (values.auth) {
                const {buildSync} = require('esbuild');
                const bundle = buildSync({entryPoints:[join(__dirname,'managed-browser.ts')],bundle:true,platform:'browser',write:false,
                    define:{__FIXTURE_CONFIG__:JSON.stringify({issuer:`https://cognito-idp.${region}.amazonaws.com/${report.outputs.AuthUserPoolId}`,
                        clientId:report.outputs.AuthManagedClientId,domain:new URL(report.outputs.AuthTokenUrl).origin,website,api:TestApiUrl})}}).outputFiles[0].contents;
                writeFileSync(join(reportDir, 'managed-browser-bundle.js'), bundle);
                await s3.send(new PutObjectCommand({Bucket:report.contentBucket,Key:'managed.js',Body:bundle,ContentType:'application/javascript',CacheControl:'no-store'}));
                await s3.send(new PutObjectCommand({Bucket:report.contentBucket,Key:'managed.html',Body:'<!doctype html><meta charset="utf-8"><title>Managed lifecycle fixture</title><body>Loading<script src="/managed.js"></script>',ContentType:'text/html',CacheControl:'no-store'}));
            }
            report.checks.staticWebsite = 'passed'; save();
            const jest = require.resolve('jest/bin/jest');
            const clientDir = resolve(__dirname, '../client');
            if (values.auth) {
                recordRevision('authentication');
                const {runAuthentication} = require('./auth-test');
                report.checks.authentication = {result:'running', checks:[], count:0}; save();
                report.checks.authentication = await runAuthentication({outputs: report.outputs, region, signal: controller.signal, log, onCheck: name => {
                    report.checks.authentication.checks.push(name); report.checks.authentication.count++; save();
                }});
                save();
            } else for (const [label, api] of [['direct-api', TestApiUrl], ['cloudfront-api', `${website}/api/dispatch`]]) {
                recordRevision(label);
                await command(label, process.execPath, [jest, '--config', 'jest.config.online.js', '--runInBand', '--json', '--outputFile', join(reportDir, `${label}-results.json`)], clientDir, {TestAPIURL: api}, 10 * 60 * 1000);
                report.checks[label] = 'passed'; save();
            }
            const ttl = await db.send(new DescribeTimeToLiveCommand({TableName: TestSessionTable}));
            if (ttl.TimeToLiveDescription.AttributeName !== 'expires' || ttl.TimeToLiveDescription.TimeToLiveStatus !== 'ENABLED') throw new Error('Session TTL is not enabled');
            const data = await db.send(new ScanCommand({TableName: TestSessionTable, ConsistentRead: true, Limit: 10}));
            if (!data.Items?.length || !data.Items.filter(i => !i.sessionId.S.startsWith('connection#')).every(i => Math.abs(Number(i.expires?.N) - Number(i.updated?.N) / 1000 - 86400) < 120)) throw new Error('Saved session expiry does not match the configured 24-hour lifetime');
            report.checks.ttl = 'passed'; report.result = 'passed'; save();
            log('Direct API, default CloudFront, WebSocket callbacks, IAM and TTL checks passed.');
        }
    } catch (e) {
        failure = e;
        if (prior) report.recoveryError = `${e.name}: ${e.message}`;
        else { if (report.checks.authentication?.result === 'running') report.checks.authentication.result = 'failed'; report.result = 'failed'; report.error = `${e.name}: ${e.message}`; }
        if (authorized || !prior) save();
    } finally {
        // Diagnostics and cleanup run without the interruption signal.
        if (authorized) {
            await diagnostics().catch(e => { log(`Diagnostics unavailable: ${e.message}`); report.diagnosticsError = e.message; });
            if (report.stackOwned || report.deploymentBucketOwned) {
                try { await cleanup(); } catch (e) { failure = failure ? new AggregateError([failure, e], 'Tests and cleanup failed') : e; log(e.message); await diagnostics().catch(diagnostic => log(`Cleanup diagnostics unavailable: ${diagnostic.message}`)); }
            }
        }
        process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
        for (const client of [sts, cf, s3, cdn, logs, db]) client.destroy();
        report.finishedAt = new Date().toISOString();
        if (authorized || !prior) save();
        log(`Report: ${reportFile}`);
    }
    if (failure) throw failure;
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

module.exports = {describeActiveStack, validateCleanupManifest, captureRevision, prepareFixture};
