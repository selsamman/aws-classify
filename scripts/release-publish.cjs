const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {spawnSync} = require('node:child_process');
const semver = require('semver');
const {checkRelease} = require('./release-lib.cjs');

const registry = 'https://registry.npmjs.org';
function npm(args, capture = false, cwd) {
    const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
        cwd, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`npm ${args[0]} failed; rerun the same release after resolving the error.`);
    return result.stdout;
}

async function registryJson(url, missing) {
    const response = await fetch(url, {signal: AbortSignal.timeout(20000), headers: {'cache-control': 'no-cache'}});
    if (response.status === 404) return missing;
    if (!response.ok) throw new Error(`Registry read failed (${response.status}); refusing to publish.`);
    return response.json();
}
const readVersion = (name, version) => registryJson(`${registry}/${encodeURIComponent(name)}/${version}`, null);
const readTags = name => registryJson(`${registry}/-/package/${encodeURIComponent(name)}/dist-tags`, {});

function assertMatching(record, published) {
    if (published && (published.name !== record.name || published.version !== record.version ||
        published.dist?.integrity !== record.integrity)) {
        throw new Error(`${record.name}@${record.version} already exists with different content. Use a new synchronized version.`);
    }
}

async function publishRelease({root, tag, prerelease, dryRun = false, runNpm,
    getVersion = readVersion, getTags = readTags, log = console.log,
    now = Date.now,
    wait = ms => new Promise(resolve => setTimeout(resolve, ms))}) {
    const release = checkRelease(root, tag, prerelease);
    runNpm ||= (args, capture) => npm(args, capture, root);
    const directory = path.join(root, '.test-results', 'release', release.version);
    fs.mkdirSync(directory, {recursive: true});
    const records = release.packages.map(item => {
        const [record] = JSON.parse(runNpm(['pack', '--workspace', item.data.name, '--ignore-scripts',
            '--json', '--pack-destination', directory], true));
        const expected = `${item.data.name}-${release.version}.tgz`;
        if (!record || record.name !== item.data.name || record.version !== release.version || record.filename !== expected) {
            throw new Error(`Unexpected packed package for ${item.data.name}.`);
        }
        const tarball = path.join(directory, record.filename);
        const integrity = 'sha512-' + createHash('sha512').update(fs.readFileSync(tarball)).digest('base64');
        if (record.integrity !== integrity) throw new Error(`Packed integrity mismatch for ${item.data.name}.`);
        for (const entry of [item.data.main, item.data.module, item.data.types]) {
            if (!entry || !record.files.some(file => file.path === entry.replace(/^\.\//, ''))) {
                throw new Error(`${item.data.name} is missing a built entry point; run npm run build.`);
            }
        }
        if (item.data.name === 'aws-classify-server' && !record.files.some(file => file.path === 'yml/functions-authenticated.yml')) {
            throw new Error('Server tarball is missing the authenticated configuration.');
        }
        return {...record, tarball};
    });
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(records, null, 2) + '\n');

    // Inspect every package before the first registry write, including rerun collisions.
    const existing = await Promise.all(records.map(record => getVersion(record.name, record.version)));
    const tags = await Promise.all(records.map(record => getTags(record.name)));
    records.forEach((record, index) => {
        assertMatching(record, existing[index]);
        const current = tags[index][release.distTag];
        if (current && (!semver.valid(current) || semver.gt(current, release.version))) {
            throw new Error(`Refusing to move ${record.name}'s ${release.distTag} backwards from ${current}.`);
        }
    });
    const pendingTag = `release-${release.version}`;
    for (const [index, record] of records.entries()) {
        if (existing[index]) {
            log(`${record.name}@${record.version} already has identical content; skipping upload.`);
        } else {
            runNpm(['publish', record.tarball, '--ignore-scripts', '--access', 'public',
                '--tag', pendingTag, '--registry', registry, ...(dryRun ? ['--dry-run'] : [])]);
        }
    }
    if (dryRun) {
        log(`Dry run complete: all three packages checked. A real run promotes ${release.distTag} only after all uploads succeed.`);
        return records;
    }

    // npm can process successful uploads for several minutes. Share one ten-minute
    // deadline across packages, and never promote until every integrity matches.
    const pending = new Map(records.map(record => [record.name, record]));
    const deadline = now() + 10 * 60 * 1000;
    let interval = 10000;
    while (pending.size) {
        const checks = await Promise.all([...pending.values()].map(async record => {
            const visible = await getVersion(record.name, record.version);
            assertMatching(record, visible);
            return {record, visible};
        }));
        for (const {record, visible} of checks) {
            if (visible) pending.delete(record.name);
        }
        if (!pending.size) break;
        const remaining = deadline - now();
        if (remaining <= 0) {
            throw new Error(`${[...pending.keys()].join(', ')}@${release.version} not visible after ten minutes. Rerun the same release; no tags were promoted.`);
        }
        log(`Waiting for npm to process ${[...pending.keys()].join(', ')}@${release.version}; no tags promoted yet.`);
        await wait(Math.min(interval, remaining));
        interval = Math.min(interval * 2, 30000);
    }
    // Recheck rollback protection at the promotion boundary as well.
    const latestTags = await Promise.all(records.map(record => getTags(record.name)));
    records.forEach((record, index) => {
        const current = latestTags[index][release.distTag];
        if (current && (!semver.valid(current) || semver.gt(current, release.version))) {
            throw new Error(`A newer ${release.distTag} appeared for ${record.name}; refusing rollback.`);
        }
    });
    for (const record of records) {
        runNpm(['dist-tag', 'add', `${record.name}@${record.version}`, release.distTag, '--registry', registry]);
    }
    const promoted = await Promise.all(records.map(record => getTags(record.name)));
    if (promoted.some(tags => tags[release.distTag] !== release.version)) {
        throw new Error('Distribution tags have not all converged. Rerun the same release to finish promotion.');
    }
    log(`All three packages published at ${release.version} (${release.distTag}).`);
    return records;
}

if (require.main === module) {
    (async () => {
        const args = process.argv.slice(2);
        if (args.some(arg => arg !== '--dry-run')) throw new Error('Only --dry-run is supported locally.');
        const dryRun = args.includes('--dry-run');
        if (!dryRun && (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_EVENT_NAME !== 'release' || !process.env.RELEASE_TAG)) {
            throw new Error('Real publication runs only in the GitHub release workflow. Use --dry-run locally.');
        }
        const root = path.resolve(__dirname, '..');
        const version = checkRelease(root).version;
        const flag = process.env.RELEASE_PRERELEASE;
        if (flag !== undefined && flag !== 'true' && flag !== 'false') throw new Error('Invalid RELEASE_PRERELEASE flag.');
        await publishRelease({root, dryRun, tag: process.env.RELEASE_TAG || `v${version}`,
            prerelease: flag === undefined ? Boolean(semver.prerelease(version)) : flag === 'true'});
    })().catch(error => {console.error(error.message); process.exitCode = 1;});
}
module.exports = {publishRelease, registryJson};
