const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');

const root = resolve(__dirname, '..');
const packages = [
    '.',
    'aws-classify-common',
    'aws-classify-client',
    'aws-classify-server',
    'aws-classify-server/tests/server',
    'aws-classify-server/tests/client',
];

if (!process.env.npm_execpath) throw new Error('Run this audit with npm run audit');

for (const directory of packages) {
    console.log(`\nAuditing ${directory === '.' ? 'repository tooling' : directory}`);
    const result = spawnSync(process.execPath, [process.env.npm_execpath, 'audit'], {
        cwd: resolve(root, directory), stdio: 'inherit',
    });
    if (result.error) console.error(result.error.message);
    if (result.error || result.status !== 0) process.exitCode = 1;
}
