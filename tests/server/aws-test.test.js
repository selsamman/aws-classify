const {test} = require('node:test');
const assert = require('node:assert/strict');
const {describeActiveStack, validateCleanupManifest} = require('./aws-test');

test('recognizes completed deletion even when AWS retains stack metadata by ARN', async () => {
    const client = {send: async () => ({Stacks: [{StackStatus: 'DELETE_COMPLETE'}]})};
    assert.equal(await describeActiveStack(client, 'owned-stack-arn'), undefined);
});
test('recognizes an absent stack but preserves permission and transport failures', async () => {
    const failure = new Error('Stack with id fixture does not exist'); failure.name = 'ValidationError';
    assert.equal(await describeActiveStack({send: async () => {throw failure;}}, 'fixture'), undefined);
    for (const name of ['AccessDenied', 'TimeoutError']) {
        const error = new Error('AWS unavailable'); error.name = name;
        await assert.rejects(describeActiveStack({send: async () => {throw error;}}, 'fixture'), error);
    }
});
test('keeps an in-progress stack active so cleanup waits for actual deletion', async () => {
    const stack = {StackStatus: 'DELETE_IN_PROGRESS'};
    assert.equal(await describeActiveStack({send: async () => ({Stacks: [stack]})}, 'fixture'), stack);
});
const identity = {Account: '123456789012'};
const service = 'aws-classify-tests-review-unique';
const manifest = {
    account: identity.Account, service, region: 'us-east-1', stackName: `${service}-dev`,
    contentBucket: `${service}-${identity.Account}`, deploymentBucket: `${service}-d-${identity.Account}`,
    stackId: `arn:aws:cloudformation:us-east-1:${identity.Account}:stack/${service}-dev/unique-id`,
};
test('allows recovery only for the recorded account and isolated resource names', () => {
    assert.doesNotThrow(() => validateCleanupManifest(manifest, identity, 'us-east-1'));
    for (const patch of [
        {account: '999999999999'}, {service: 'production'}, {stackName: 'production'},
        {region: 'eu-west-1'}, {contentBucket: 'shared-content'}, {deploymentBucket: 'shared-artifacts'},
        {stackId: `arn:aws:cloudformation:us-east-1:${identity.Account}:stack/production/unique-id`},
    ]) {
        assert.throws(() => validateCleanupManifest({...manifest, ...patch}, identity, 'us-east-1'));
    }
});

test('prepares separate Serverless build directories with bounded fixture names', () => {
    const {mkdtempSync,rmSync,readFileSync,realpathSync} = require('node:fs');
    const {tmpdir} = require('node:os');
    const {join} = require('node:path');
    const {prepareFixture} = require('./aws-test');
    const dir=mkdtempSync(join(tmpdir(),'classify-runner-fixture-'));
    try {
        const a=prepareFixture(join(dir,'a')), b=prepareFixture(join(dir,'b'));
        assert.notEqual(a,b);
        assert.equal(realpathSync(join(a,'node_modules')),realpathSync(join(b,'node_modules')));
        assert.match(readFileSync(join(a,'serverless-auth.yml'),'utf8'),/fixture-functions-authenticated.yml/);
        assert.match(readFileSync(join(a,'serverless-auth.yml'),'utf8'),/name: \$\{self:service\}-\$\{sls:stage\}-notify/);
        const functions=readFileSync(join(a,'fixture-functions-authenticated.yml'),'utf8');
        assert.match(functions,/name: \$\{self:service\}-\$\{sls:stage\}-disconnect/);
        assert.match(functions,/authentication-config.js\):authorizer/);
    } finally {rmSync(dir,{recursive:true,force:true});}
});
test('loads YAML coverage configuration with the audited YAML parser override', async () => {
    const {mkdtempSync,writeFileSync,rmSync}=require('node:fs');
    const {tmpdir}=require('node:os');const {join}=require('node:path');
    const dir=mkdtempSync(join(tmpdir(),'classify-coverage-config-'));
    try {
        writeFileSync(join(dir,'.nycrc.yml'),'all: true\ninclude:\n  - src/**/*.ts\nexclude:\n  - tests/**\n');
        const config=await require('@istanbuljs/load-nyc-config').loadNycConfig({cwd:dir});
        assert.equal(config.all,true);assert.deepEqual(config.include,['src/**/*.ts']);assert.deepEqual(config.exclude,['tests/**']);
    } finally {rmSync(dir,{recursive:true,force:true});}
});
