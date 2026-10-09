const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {createHash} = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {packages, checkRelease, setReleaseVersion} = require('../scripts/release-lib.cjs');
const {publishRelease} = require('../scripts/release-publish.cjs');

function fixture(t, version = '0.2.0') {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aws-classify-release-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const workspaces = [...packages, 'tests/requests', 'tests/client', 'tests/server'];
    const lock = {lockfileVersion: 3, packages: {}};
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({private: true, workspaces}));
    for (const directory of workspaces) {
        const library = packages.includes(directory);
        const name = library ? directory : '@aws-classify-' + directory.replace('/', '/');
        const dependency = directory === 'tests/client' ? packages[1] : directory === 'tests/server' ? packages[2] : packages[0];
        const data = {name, version: library ? version : '0.1.0',
            main: './lib/cjs/index.js', module: './lib/esm/index.js', types: './lib/esm/index.d.ts',
            dependencies: {...(directory === packages[0] ? {} : {[dependency]: version}), unrelated: '^1.0.0'},
            ...(library ? {} : {private: true})};
        fs.mkdirSync(path.join(root, directory), {recursive: true});
        fs.writeFileSync(path.join(root, directory, 'package.json'), JSON.stringify(data));
        lock.packages[directory] = structuredClone(data);
    }
    fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify(lock));
    return root;
}
function edit(root, filename, change) {
    const target = path.join(root, filename);
    const data = JSON.parse(fs.readFileSync(target)); change(data);
    fs.writeFileSync(target, JSON.stringify(data));
}
function fakeRegistry(root, version = '0.2.0') {
    const state = {versions: new Map(), tags: new Map(packages.map(name => [name, {latest: '0.1.0'}])),
        calls: [], failPublish: undefined, failPromotion: undefined, omitEntry: false};
    const records = new Map();
    const options = {root, tag: `v${version}`, prerelease: version.includes('-'), log: () => {}, wait: async () => {},
        getVersion: async name => state.versions.get(name) || null,
        getTags: async name => ({...state.tags.get(name)}),
        runNpm(args) {
            if (args[0] === 'pack') {
                const name = args[args.indexOf('--workspace') + 1];
                const directory = args[args.indexOf('--pack-destination') + 1];
                const content = Buffer.from(`${name}@${version}`);
                const record = {name, version, filename: `${name}-${version}.tgz`,
                    integrity: 'sha512-' + createHash('sha512').update(content).digest('base64'),
                    files: (state.omitEntry ? [] : ['lib/cjs/index.js', 'lib/esm/index.js', 'lib/esm/index.d.ts',
                        'yml/functions-authenticated.yml']).map(file => ({path: file}))};
                fs.writeFileSync(path.join(directory, record.filename), content);
                records.set(path.join(directory, record.filename), record);
                return JSON.stringify([record]);
            }
            if (args[0] === 'publish') {
                const record = records.get(args[1]);
                if (args.includes('--dry-run')) {state.calls.push(['dry-run', record.name]); return;}
                if (state.failPublish === record.name) throw new Error('simulated upload failure');
                state.calls.push(['publish', record.name]);
                state.versions.set(record.name, {name: record.name, version, dist: {integrity: record.integrity}});
                state.tags.get(record.name)[args[args.indexOf('--tag') + 1]] = version;
                return;
            }
            if (args[0] === 'dist-tag') {
                const [name, value] = args[2].split('@');
                assert.equal(state.versions.size, 3, 'all versions must exist before promotion');
                if (state.failPromotion === name) throw new Error('simulated promotion failure');
                state.calls.push(['promote', name, args[3]]);
                state.tags.get(name)[args[3]] = value;
                return;
            }
            throw new Error(`Unexpected command ${args[0]}`);
        }};
    return {state, options};
}

test('one version operation synchronizes libraries and internal references without changing private package versions', t => {
    const root = fixture(t, '0.1.0');
    edit(root, 'aws-classify-server/package.json', data => {data.version = '0.1.9';});
    edit(root, 'package-lock.json', data => {data.packages['aws-classify-server'].version = '0.1.9';});
    setReleaseVersion(root, '0.2.0');
    assert.equal(checkRelease(root, 'v0.2.0', false).version, '0.2.0');
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'tests/client/package.json')));
    assert.equal(pkg.version, '0.1.0'); assert.equal(pkg.dependencies['aws-classify-client'], '0.2.0');
    assert.equal(pkg.dependencies.unrelated, '^1.0.0');
    const before = fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8');
    setReleaseVersion(root, '0.2.0');
    assert.equal(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'), before);
});

test('invalid versions and downgrades do not modify release manifests', t => {
    const root = fixture(t);
    const before = fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8');
    for (const version of ['v0.3.0', '0.03.0', '0.3.0+build', '0.1.0', 'latest', '0.3.0;echo bad']) {
        assert.throws(() => setReleaseVersion(root, version));
    }
    assert.equal(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'), before);
    assert.equal(checkRelease(root).version, '0.2.0');
});

test('version drift, tag mismatches and prerelease mismatches fail before publication', t => {
    const root = fixture(t);
    assert.throws(() => checkRelease(root, 'v0.1.0', false), /tag/);
    assert.throws(() => checkRelease(root, 'v0.2.0', true), /prerelease/);
    edit(root, 'aws-classify-client/package.json', data => {data.version = '0.2.1';});
    assert.throws(() => checkRelease(root), /versions differ/);
});

test('stale common references and stale lockfile entries are rejected', t => {
    const root = fixture(t);
    edit(root, 'tests/client/package.json', data => {data.dependencies['aws-classify-client'] = '^0.2.0';});
    assert.throws(() => checkRelease(root), /exactly 0.2.0/);
    setReleaseVersion(root, '0.2.0');
    edit(root, 'package-lock.json', data => {data.packages['aws-classify-client'].version = '0.1.0';});
    assert.throws(() => checkRelease(root), /Lockfile version/);
});

test('a successful release uploads all three before promoting any distribution tag', async t => {
    const {state, options} = fakeRegistry(fixture(t));
    await publishRelease(options);
    assert.deepEqual(state.calls.map(call => call[0]), ['publish', 'publish', 'publish', 'promote', 'promote', 'promote']);
    assert.deepEqual(state.calls.slice(0, 3).map(call => call[1]), packages);
    for (const tags of state.tags.values()) assert.equal(tags.latest, '0.2.0');
});

test('a failed upload does not promote latest and rerunning resumes the missing packages', async t => {
    const {state, options} = fakeRegistry(fixture(t)); state.failPublish = packages[1];
    await assert.rejects(publishRelease(options), /upload failure/);
    assert.deepEqual(state.calls, [['publish', packages[0]]]);
    for (const tags of state.tags.values()) assert.equal(tags.latest, '0.1.0');
    state.failPublish = undefined;
    await publishRelease(options);
    assert.equal(state.calls.filter(call => call[0] === 'publish' && call[1] === packages[0]).length, 1);
    assert.equal(state.versions.size, 3);
});

test('a failed tag promotion can be repaired without republishing immutable versions', async t => {
    const {state, options} = fakeRegistry(fixture(t)); state.failPromotion = packages[2];
    await assert.rejects(publishRelease(options), /promotion failure/);
    assert.equal(state.tags.get(packages[2]).latest, '0.1.0');
    state.failPromotion = undefined;
    await publishRelease(options);
    assert.equal(state.calls.filter(call => call[0] === 'publish').length, 3);
    for (const tags of state.tags.values()) assert.equal(tags.latest, '0.2.0');
});

test('a conflicting existing third package is detected before uploading the first', async t => {
    const {state, options} = fakeRegistry(fixture(t));
    state.versions.set(packages[2], {name: packages[2], version: '0.2.0', dist: {integrity: 'different'}});
    await assert.rejects(publishRelease(options), /different content/);
    assert.deepEqual(state.calls, []);
});

test('older releases cannot roll distribution tags back', async t => {
    const {state, options} = fakeRegistry(fixture(t)); state.tags.get(packages[2]).latest = '0.3.0';
    await assert.rejects(publishRelease(options), /backwards/);
    assert.deepEqual(state.calls, []);
});

test('a newer release appearing at the promotion boundary blocks rollback', async t => {
    const {state, options} = fakeRegistry(fixture(t)); let reads = 0;
    const getTags = options.getTags;
    options.getTags = async name => {reads++; return reads > 3 ? {latest: '0.3.0'} : getTags(name);};
    await assert.rejects(publishRelease(options), /newer latest/);
    assert.equal(state.calls.filter(call => call[0] === 'promote').length, 0);
});

test('prereleases promote next and leave latest unchanged', async t => {
    const {state, options} = fakeRegistry(fixture(t, '0.3.0-rc.1'), '0.3.0-rc.1');
    await publishRelease(options);
    for (const tags of state.tags.values()) {assert.equal(tags.next, '0.3.0-rc.1'); assert.equal(tags.latest, '0.1.0');}
});

test('dry runs never publish versions or change distribution tags', async t => {
    const {state, options} = fakeRegistry(fixture(t));
    await publishRelease({...options, dryRun: true});
    assert.equal(state.versions.size, 0);
    assert.deepEqual(state.calls.map(call => call[0]), ['dry-run', 'dry-run', 'dry-run']);
});

test('registry read errors stop publication rather than treating failures as missing versions', async t => {
    const {state, options} = fakeRegistry(fixture(t));
    await assert.rejects(publishRelease({...options, getVersion: async () => {throw new Error('registry unavailable');}}), /unavailable/);
    assert.deepEqual(state.calls, []);
});

test('missing build output fails before any registry writes', async t => {
    const {state, options} = fakeRegistry(fixture(t)); state.omitEntry = true;
    await assert.rejects(publishRelease(options), /missing a built entry/);
    assert.deepEqual(state.calls, []);
});

test('registry visibility lag is retried before promotion', async t => {
    const {state, options} = fakeRegistry(fixture(t)); let lag = 0;
    const getVersion = options.getVersion;
    options.getVersion = async name => {
        if (state.versions.has(name) && name === packages[2] && lag++ < 2) return null;
        return getVersion(name);
    };
    await publishRelease(options); assert.equal(lag, 3);
});

test('real publication is refused from a local invocation', () => {
    const result = spawnSync(process.execPath, [path.join(__dirname, '../scripts/release-publish.cjs')], {
        encoding: 'utf8', env: {...process.env, GITHUB_ACTIONS: 'false'},
    });
    assert.equal(result.status, 1); assert.match(result.stderr, /only in the GitHub release workflow/);
});
