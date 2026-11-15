// Assertions shared by the disposable AWS runner and its regression tests.
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {setTimeout: delay} = require('node:timers/promises');

function assertStaticTemplate(template, authenticated) {
    const resources = template.Resources;
    const distribution = resources.CloudFrontDistribution.Properties.DistributionConfig;
    const behavior = distribution.DefaultCacheBehavior;
    assert.equal(behavior.TargetOriginId, 'static');
    assert.deepEqual(behavior.CachePolicyId, {Ref: 'AWSClassifyStaticCachePolicy'});
    assert.deepEqual(behavior.FunctionAssociations, [{EventType: 'viewer-request', FunctionARN: {'Fn::GetAtt': ['AWSClassifySpaEntry', 'FunctionARN']}}]);
    const entry = resources.AWSClassifySpaEntry.Properties;
    assert.equal(entry.AutoPublish, true);
    assert.equal(entry.FunctionConfig.Runtime, 'cloudfront-js-2.0');
    assert.match(entry.FunctionCode, /request.uri === "\/app"/);
    assert.match(entry.FunctionCode, /request.uri = "\/app\/index.html"/);
    const policy = resources.AWSClassifyStaticCachePolicy.Properties.CachePolicyConfig;
    assert.equal(policy.MinTTL, 0); assert.equal(policy.DefaultTTL, 0); assert.equal(policy.MaxTTL, 31536000);
    assert.deepEqual(distribution.CustomErrorResponses, [{ErrorCode: 403, ErrorCachingMinTTL: 0, ResponseCode: {Ref: 'AWS::NoValue'}, ResponsePagePath: {Ref: 'AWS::NoValue'}}]);
    assert.equal(distribution.Origins.length, 2);
    assert.deepEqual(distribution.Origins.map(origin => origin.Id), ['api', 'static']);
    assert.equal(distribution.DefaultRootObject, 'index.html');
    assert.equal(distribution.CacheBehaviors.length, 1);
    const api = distribution.CacheBehaviors[0];
    assert.equal(api.PathPattern, 'api/*'); assert.equal(api.TargetOriginId, 'api');
    assert.equal(api.FunctionAssociations, undefined);
    assert.deepEqual(api.AllowedMethods, ['GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT', 'DELETE']);
    if (authenticated) {
        assert.equal(api.CachePolicyId, '4135ea2d-6df8-44a3-9df3-4b5a84be39ad');
        assert.equal(api.OriginRequestPolicyId, 'b689b0a8-53d0-40ab-baf2-68738e2966ac');
        const routes = Object.values(resources).filter(resource => resource.Type === 'AWS::ApiGatewayV2::Route');
        assert.ok(routes.some(route => route.Properties.RouteKey === 'ANY /api/dispatch' && route.Properties.AuthorizationType === 'JWT'));
        assert.ok(routes.some(route => route.Properties.RouteKey === 'ANY /api/dispatch/public' && [undefined, 'NONE'].includes(route.Properties.AuthorizationType) && !route.Properties.AuthorizerId));
    } else {
        assert.deepEqual(api.ForwardedValues, {QueryString: true});
        assert.equal(api.MinTTL, 0); assert.equal(api.DefaultTTL, 0);
    }
}

async function verifyStaticWebsite({website, source, signal}) {
    const checks = [];
    async function check(path, verify) {
        const deadline = Date.now() + 120000;
        while (true) {
            signal.throwIfAborted();
            try {
                const response = await fetch(website + path, {signal: AbortSignal.any([signal, AbortSignal.timeout(15000)])});
                const body = await response.text();
                verify(response, body);
                checks.push(path); break;
            } catch (error) {
                if (signal.aborted || Date.now() >= deadline) throw error;
                await delay(2000);
            }
        }
    }
    const html = file => readFileSync(join(source, file), 'utf8');
    for (const [path, file] of [['/', 'index.html'], ['/about.html', 'about.html'], ['/app', 'app/index.html'], ['/app/', 'app/index.html'], ['/app?code=fixture-code&state=fixture-state', 'app/index.html']]) {
        await check(path, (response, body) => {
            assert.equal(response.status, 200, path); assert.equal(body, html(file));
            assert.equal(response.headers.get('cache-control'), 'no-cache');
            assert.match(response.headers.get('content-type'), /^text\/html/);
            assert.equal(response.redirected, false);
        });
    }
    const assets = [...html('app/index.html').matchAll(/(?:src|href)="(\/app\/assets\/[^\"]+)"/g)].map(match => match[1]);
    assert.ok(assets.length >= 2);
    for (const path of assets) await check(path, (response, body) => {
        assert.equal(response.status, 200);
        assert.equal(body, html(path));
        assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    });
    for (const path of ['/missing-public.html', '/app/missing.js', '/app/deep', '/about', '/api/missing-static-page'])
        await check(path, (response, body) => {assert.ok([403, 404].includes(response.status), `${path}: ${response.status}`); assert.notEqual(body, html('index.html')); assert.notEqual(body, html('app/index.html'));});
    return {result: 'passed', count: checks.length, checks};
}
module.exports = {assertStaticTemplate, verifyStaticWebsite};
