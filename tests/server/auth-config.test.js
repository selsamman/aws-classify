const {test} = require('node:test');
const assert = require('node:assert/strict');
const resolver = require('../../aws-classify-server/yml/authentication-config');
const resolve = (custom, authorizers={application:{type:'jwt'}}, logging=null) => resolver({resolveVariable: async key => key.includes('custom.awsClassify') ? custom : key.includes('httpApi.authorizers') ? authorizers : logging});
test('preserves the application authorizer and optional route scopes', async () => {
    const authorizer={name:'application',scopes:['example/invoke','example/alternate']};
    assert.deepEqual(await resolve({authorizer,publicSuffix:'Public'}),{authorizer,publicSuffix:'Public'});
    assert.deepEqual((await resolve({authorizer:{name:'application'},publicSuffix:'Anonymous'})).authorizer,{name:'application'});
});
test('fails configuration before deployment for missing and undefined authorizers', async () => {
    for(const custom of [undefined,{}, {authorizer:{}}, {authorizer:{name:''}}]) await assert.rejects(resolve(custom),/requires an authorizer/);
    await assert.rejects(resolve({authorizer:{name:'missing'},publicSuffix:'Public'}),/must be defined/);
});
test('rejects ambiguous suffixes and malformed scopes', async () => {
    for(const publicSuffix of ['', '*', '$authorize', ' Public', undefined]) await assert.rejects(resolve({authorizer:{name:'application'},publicSuffix}),/publicSuffix/);
    for(const scopes of ['scope',[null],[''],['two scopes']]) await assert.rejects(resolve({authorizer:{name:'application',scopes},publicSuffix:'Public'}),/scopes/);
});
test('allows request authorizers and prevents WebSocket credential tracing', async () => {
    const config={authorizer:{name:'application'},publicSuffix:'Public'};
    await resolve(config,{application:{type:'request'}},{fullExecutionData:false});
    await assert.rejects(resolve(config,undefined,true),/fullExecutionData/);
    await assert.rejects(resolve(config,undefined,{fullExecutionData:true}),/fullExecutionData/);
});
