const fs = require('node:fs');
const path = require('node:path');
const semver = require('semver');

const packages = ['aws-classify-common', 'aws-classify-client', 'aws-classify-server'];
const dependencyFields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const readJson = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
const json = value => JSON.stringify(value, null, 2) + '\n';

function validateVersion(version) {
    if (!version || semver.valid(version) !== version || version.includes('+')) {
        throw new Error('Use a canonical version such as 0.2.0 or 0.3.0-rc.1, without v or build metadata.');
    }
    return version;
}

function load(root) {
    const workspace = readJson(path.join(root, 'package.json'));
    const lock = readJson(path.join(root, 'package-lock.json'));
    if (lock.lockfileVersion !== 3 || !Array.isArray(workspace.workspaces)) {
        throw new Error('Release tools require the repository workspace list and npm lockfile v3.');
    }
    const manifests = workspace.workspaces.map(directory => ({
        directory, filename: path.join(root, directory, 'package.json'),
        data: readJson(path.join(root, directory, 'package.json')),
    }));
    return {manifests, lock};
}

function checkRelease(root, tag, prerelease) {
    const {manifests, lock} = load(root);
    const selected = packages.map(name => {
        const manifest = manifests.find(item => item.data.name === name);
        if (!manifest || manifest.data.private) throw new Error(`Missing public workspace ${name}.`);
        validateVersion(manifest.data.version);
        return manifest;
    });
    const version = selected[0].data.version;
    if (selected.some(item => item.data.version !== version)) {
        throw new Error('Package versions differ. Run npm run release:version -- <version>.');
    }
    if (tag !== undefined && tag !== `v${version}`) throw new Error(`Release tag must be v${version}.`);
    if (prerelease !== undefined && prerelease !== Boolean(semver.prerelease(version))) {
        throw new Error('GitHub prerelease status must match the version (for example 0.3.0-rc.1).');
    }
    for (const manifest of manifests) {
        const entry = lock.packages[manifest.directory];
        if (!entry || entry.version !== manifest.data.version) {
            throw new Error(`Lockfile version differs for ${manifest.data.name}.`);
        }
        for (const field of dependencyFields) {
            for (const name of packages) {
                const wanted = manifest.data[field]?.[name];
                const locked = entry[field]?.[name];
                if (wanted !== locked || (wanted !== undefined && wanted !== version)) {
                    throw new Error(`${manifest.data.name}: ${field}.${name} must be exactly ${version} in manifest and lockfile.`);
                }
            }
        }
    }
    for (const item of selected.slice(1)) {
        if (item.data.dependencies?.['aws-classify-common'] !== version) {
            throw new Error(`${item.data.name} must depend on aws-classify-common@${version}.`);
        }
    }
    return {version, packages: selected, distTag: semver.prerelease(version) ? 'next' : 'latest'};
}

function setReleaseVersion(root, version) {
    validateVersion(version);
    const {manifests, lock} = load(root);
    for (const name of packages) {
        const manifest = manifests.find(item => item.data.name === name);
        if (!manifest || manifest.data.private) throw new Error(`Missing public workspace ${name}.`);
        if (semver.lt(version, validateVersion(manifest.data.version))) {
            throw new Error(`Refusing to lower ${name} from ${manifest.data.version} to ${version}.`);
        }
    }
    for (const manifest of manifests) {
        const entry = lock.packages[manifest.directory];
        if (!entry) throw new Error(`Missing lockfile entry for ${manifest.directory}.`);
        if (packages.includes(manifest.data.name)) entry.version = manifest.data.version = version;
        for (const field of dependencyFields) {
            for (const name of packages) {
                if (manifest.data[field]?.[name] !== undefined) {
                    manifest.data[field][name] = version;
                    if (!entry[field]) entry[field] = {};
                    entry[field][name] = version;
                }
            }
        }
    }
    const updates = manifests.map(item => [item.filename, json(item.data)]);
    updates.push([path.join(root, 'package-lock.json'), json(lock)]);
    const originals = updates.map(([filename]) => [filename, fs.readFileSync(filename)]);
    try {
        for (const [filename, contents] of updates) fs.writeFileSync(filename, contents);
        checkRelease(root);
    } catch (error) {
        for (const [filename, contents] of originals) fs.writeFileSync(filename, contents);
        throw error;
    }
}

module.exports = {packages, checkRelease, setReleaseVersion, validateVersion};
