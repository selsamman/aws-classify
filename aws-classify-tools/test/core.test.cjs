const assert = require('node:assert/strict');
const {mkdtempSync, readFileSync, rmSync, writeFileSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const test = require('node:test');
const {publishSite, stackName, stackOutputValues, writeStackOutputs} = require('../lib/core.cjs');

test('derives the normal Serverless stack name without duplicating it', () => {
    assert.equal(stackName({service: 'chat', provider: {}}, 'dev'), 'chat-dev');
    assert.equal(stackName({service: 'chat', provider: {stackName: 'managed-name'}}, 'dev'), 'managed-name');
});

test('publishes every source file, deletes stale keys and invalidates CloudFront', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'aws-classify-tools-'));
    try {
        writeFileSync(join(directory, 'index.html'), '<title>chat</title>');
        writeFileSync(join(directory, 'app.js'), 'console.log(1)');
        const calls = [];
        const s3 = {send: async command => {
            calls.push(command.input);
            if (command.constructor.name === 'ListObjectsV2Command') return {Contents: [{Key: 'stale.js'}]};
            return {};
        }};
        const cloudfront = {send: async command => { calls.push(command.input); return {}; }};
        const result = await publishSite({source: directory, bucket: 'content', distributionId: 'distribution', region: 'us-east-1', s3, cloudfront});
        assert.deepEqual(result, {files: 2, removed: 1});
        assert(calls.some(call => call.Key === 'index.html' && call.CacheControl === 'no-cache'));
        assert(calls.some(call => call.Key === 'app.js'));
        assert(calls.some(call => call.Delete?.Objects[0].Key === 'stale.js'));
        assert(calls.some(call => call.DistributionId === 'distribution' && call.InvalidationBatch.Paths.Items[0] === '/*'));
    } finally { rmSync(directory, {recursive: true, force: true}); }
});

// Expo consumes this file with JSON.parse after publication.
test('published stack outputs can be read as JSON by a consumer', () => {
    const directory = mkdtempSync(join(tmpdir(), 'aws-classify-outputs-'));
    try {
        const filename = join(directory, 'output.json');
        const outputs = {WebsiteUrl: 'example.cloudfront.net', ContentBucket: 'content', CloudFrontId: 'distribution'};
        writeStackOutputs(filename, outputs);
        assert.deepEqual(JSON.parse(readFileSync(filename, 'utf8')), outputs);
    } finally { rmSync(directory, {recursive: true, force: true}); }
});

// A first deployment can expose its resources before its outputs are available.
test('in-progress stack operations are reported before missing/stale outputs are used', () => {
    for (const StackStatus of ['CREATE_IN_PROGRESS', 'UPDATE_IN_PROGRESS', 'UPDATE_COMPLETE_CLEANUP_IN_PROGRESS', 'DELETE_IN_PROGRESS']) {
        assert.throws(() => stackOutputValues({StackStatus, Outputs: [{OutputKey: 'ContentBucket', OutputValue: 'old'}]}, 'app-dev'),
            error => error.message.includes(StackStatus) && error.message.includes('Wait for the current stack operation'));
    }
    assert.deepEqual(stackOutputValues({StackStatus: 'CREATE_COMPLETE', Outputs: [{OutputKey: 'ContentBucket', OutputValue: 'content'}]}, 'app-dev'), {ContentBucket: 'content'});
    assert.deepEqual(stackOutputValues({StackStatus: 'UPDATE_COMPLETE'}, 'app-dev'), {});
    assert.throws(() => stackOutputValues(undefined, 'app-dev'), /stack was not found: app-dev/);
});
