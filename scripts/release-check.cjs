const path = require('node:path');
const {checkRelease} = require('./release-lib.cjs');
try {
    const flag = process.env.RELEASE_PRERELEASE;
    if (flag !== undefined && flag !== 'true' && flag !== 'false') throw new Error('Invalid RELEASE_PRERELEASE flag.');
    const result = checkRelease(path.resolve(__dirname, '..'), process.env.RELEASE_TAG,
        flag === undefined ? undefined : flag === 'true');
    console.log(`Release ${result.version}: all three packages and internal references match (${result.distTag}).`);
} catch (error) {console.error(error.message); process.exitCode = 1;}
