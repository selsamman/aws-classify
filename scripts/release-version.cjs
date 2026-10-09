const path = require('node:path');
const {setReleaseVersion} = require('./release-lib.cjs');
try {
    if (process.argv.length !== 3) throw new Error('Usage: npm run release:version -- <version>');
    setReleaseVersion(path.resolve(__dirname, '..'), process.argv[2]);
    console.log(`All three library versions, workspace references and lockfile updated to ${process.argv[2]}.`);
    console.log('Review and commit these changes before creating the matching GitHub release.');
} catch (error) {console.error(error.message); process.exitCode = 1;}
