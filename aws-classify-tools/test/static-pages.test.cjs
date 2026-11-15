const assert = require('node:assert/strict');
const {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const {runInNewContext} = require('node:vm');
const test = require('node:test');
const {publishSite, spaDirectoryFromPackage} = require('../lib/core.cjs');
const resolver = require('../../aws-classify-server/yml/static-pages-config.js');

for (const spaDirectory of ['app', 'member/app']) {
    test(`entry rewrite preserves public files, deep links, API requests and query parameters: ${spaDirectory}`, async () => {
        const {functionCode} = await resolver({resolveVariable: async key => {
            assert.equal(key, 'file(../package.json):awsClassify.spaDirectory');
            return spaDirectory;
        }});
        const handler = runInNewContext(functionCode + '\nhandler');
        for (const uri of [`/${spaDirectory}`, `/${spaDirectory}/`, '/', '/about.html', '/api/dispatch', '/api/public/dispatch', '/assets/x.js', `/${spaDirectory}/assets/x.js`, `/${spaDirectory}/index.html`, `/${spaDirectory}/deep`, `/${spaDirectory}-other`]) {
            const request = {uri, method: 'GET', querystring: {code: {value: 'abc'}, state: {value: 'xyz'}}, headers: {}};
            const query = request.querystring;
            assert.equal(handler({request}), request);
            assert.equal(request.uri, [`/${spaDirectory}`, `/${spaDirectory}/`].includes(uri) ? `/${spaDirectory}/index.html` : uri);
            assert.equal(request.querystring, query);
            assert.equal(request.querystring.code.value, 'abc');
        }
    });
}

test('hosting and publisher reject unsafe or conflicting directories consistently', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'aws-classify-setting-'));
    const filename = join(directory, 'package.json');
    try {
        for (const value of ['', null, 42, {}, '/app', 'app/', '../app', 'app/../x', 'a//b', 'app?q', 'api', 'api/app', 'a b']) {
            writeFileSync(filename, JSON.stringify({awsClassify: {spaDirectory: value}}));
            assert.throws(() => spaDirectoryFromPackage(filename), /spaDirectory/);
            await assert.rejects(resolver({resolveVariable: async () => value}), /spaDirectory/);
        }
        for (const value of ['app', 'member/app', 'APP-1/_two']) {
            writeFileSync(filename, JSON.stringify({awsClassify: {spaDirectory: value}}));
            assert.equal(spaDirectoryFromPackage(filename), value);
            await resolver({resolveVariable: async () => value});
        }
        writeFileSync(filename, '{}');
        assert.equal(spaDirectoryFromPackage(filename), undefined);
        await assert.rejects(resolver({resolveVariable: async () => undefined}), /spaDirectory/);
    } finally {rmSync(directory, {recursive: true, force: true});}
});

for (const spaDirectory of [undefined, 'app', 'member/app']) {
    test(`publication assigns cache headers and MIME types: ${spaDirectory || 'legacy'}`, async () => {
        const directory = mkdtempSync(join(tmpdir(), 'aws-classify-static-'));
        const prefix = spaDirectory || 'app';
        const files = ['index.html', 'about.html', 'assets/root.js', 'assets/document.HTML', `${prefix}/index.html`, `${prefix}/assets/bundle.js`, `${prefix}/assets/style.css`, `${prefix}/assets/page.html`, `${prefix}/public.js`, 'other/assets/script.js'];
        const uploads = [];
        try {
            for (const file of files) {
                mkdirSync(join(directory, file, '..'), {recursive: true});
                writeFileSync(join(directory, file), file);
            }
            const s3 = {send: async command => {
                if (command.constructor.name === 'PutObjectCommand') uploads.push(command.input);
                return {};
            }};
            await publishSite({source: directory, bucket: 'bucket', distributionId: 'id', spaDirectory, s3, cloudfront: {send: async () => ({})}});
            assert.equal(uploads.length, files.length);
            for (const upload of uploads) {
                const immutable = upload.Key === 'assets/root.js' || (spaDirectory && [`${prefix}/assets/bundle.js`, `${prefix}/assets/style.css`].includes(upload.Key));
                assert.equal(upload.CacheControl, immutable ? 'public, max-age=31536000, immutable' : 'no-cache', upload.Key);
                assert.equal(upload.Body.toString(), upload.Key);
                if (upload.Key.endsWith('.html')) assert.equal(upload.ContentType, 'text/html');
            }
        } finally {rmSync(directory, {recursive: true, force: true});}
    });
}

// Serverless merges resource includes with lodash.merge. Test that real merge
// behavior, especially its array merging and removal of legacy error rewrites.
const yaml = require('js-yaml');
const {merge} = require('lodash');
const schema = yaml.DEFAULT_SCHEMA.extend(['Ref', 'GetAtt', 'Join'].map(tag =>
    new yaml.Type('!' + tag, {kind: tag === 'Ref' || tag === 'GetAtt' ? 'scalar' : 'sequence',
        construct: value => ({[tag === 'Ref' ? tag : 'Fn::' + tag]: value})})));
const loadTemplate = name => yaml.load(readFileSync(join(__dirname, '../../aws-classify-server/yml', name), 'utf8'), {schema});
for (const name of ['resources-website.yml', 'resources-website-authenticated.yml', 'resources-custom-website.yml']) {
    test(`static-pages opt-in retains website and API behavior: ${name}`, () => {
        const base = loadTemplate(name);
        const original = structuredClone(base);
        const overlay = loadTemplate('resources-static-pages.yml');
        const combined = merge({}, base, overlay);
        const before = base.Resources.CloudFrontDistribution.Properties.DistributionConfig;
        const after = combined.Resources.CloudFrontDistribution.Properties.DistributionConfig;
        assert.deepEqual(base, original, 'non-opted-in configuration is unchanged');
        for (const key of Object.keys(before).filter(key => !['DefaultCacheBehavior', 'CustomErrorResponses'].includes(key)))
            assert.deepEqual(after[key], before[key], key);
        assert.deepEqual(combined.Outputs, base.Outputs);
        assert.deepEqual(combined.Resources.S3BucketPolicy, base.Resources.S3BucketPolicy);
        assert.equal(after.DefaultCacheBehavior.TargetOriginId, 'static');
        assert.equal(after.DefaultCacheBehavior.CachePolicyId.Ref, 'AWSClassifyStaticCachePolicy');
        assert.deepEqual(after.DefaultCacheBehavior.FunctionAssociations, [{EventType: 'viewer-request', FunctionARN: {'Fn::GetAtt': 'AWSClassifySpaEntry.FunctionARN'}}]);
        assert.equal(after.CustomErrorResponses[0].ErrorCode, 403);
        assert.equal(after.CustomErrorResponses[0].ErrorCachingMinTTL, 0);
        assert.deepEqual(after.CustomErrorResponses[0].ResponseCode, {Ref: 'AWS::NoValue'});
        assert.deepEqual(after.CustomErrorResponses[0].ResponsePagePath, {Ref: 'AWS::NoValue'});
        const policy = combined.Resources.AWSClassifyStaticCachePolicy.Properties.CachePolicyConfig;
        assert.equal(policy.MinTTL, 0);
        assert.equal(policy.DefaultTTL, 0);
        assert.equal(policy.MaxTTL, 31536000);
        assert.equal(combined.Resources.AWSClassifySpaEntry.Properties.AutoPublish, true);
    });
}

test('documented assembly combines independent builds, removes stale output and detects collisions', () => {
    const {execFileSync} = require('node:child_process');
    const {existsSync} = require('node:fs');
    const directory = mkdtempSync(join(tmpdir(), 'aws-classify-assembly-'));
    try {
        const guide = readFileSync(join(__dirname, '../../usersguide/content/guides/static-pages.md'), 'utf8');
        const script = guide.match(/```javascript\n([\s\S]*?)\n```/)[1];
        writeFileSync(join(directory, 'assemble.mjs'), script);
        for (const spaDirectory of ['app', 'member/app']) {
            writeFileSync(join(directory, 'package.json'), JSON.stringify({awsClassify: {spaDirectory}}));
            const files = {'public-site/dist/index.html': '<title>Public</title>', 'public-site/dist/about.html': '<title>About</title>',
                [`web/dist/${spaDirectory}/index.html`]: `<script src="/${spaDirectory}/assets/main-123.js"></script>`,
                [`web/dist/${spaDirectory}/assets/main-123.js`]: 'console.log("app")'};
            for (const [file, content] of Object.entries(files)) {
                mkdirSync(join(directory, file, '..'), {recursive: true});
                writeFileSync(join(directory, file), content);
            }
            execFileSync(process.execPath, ['assemble.mjs'], {cwd: directory});
            for (const [file, content] of Object.entries(files)) {
                const output = file.startsWith('public-site/') ? file.replace('public-site/dist/', '') : file.replace('web/dist/', '');
                assert.equal(readFileSync(join(directory, 'site-dist', output), 'utf8'), content);
                assert.equal(readFileSync(join(directory, file), 'utf8'), content, 'build input is retained');
            }
            writeFileSync(join(directory, 'site-dist/stale.txt'), 'old');
            execFileSync(process.execPath, ['assemble.mjs'], {cwd: directory});
            assert.equal(existsSync(join(directory, 'site-dist/stale.txt')), false);
        }
        mkdirSync(join(directory, 'public-site/dist/member/app'), {recursive: true});
        assert.throws(() => execFileSync(process.execPath, ['assemble.mjs'], {cwd: directory, stdio: 'pipe'}), /collides/);
    } finally {rmSync(directory, {recursive: true, force: true});}
});
