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
