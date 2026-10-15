const {join, resolve} = require('node:path');
const {emptyBucket, initializeLocalDb, publishFromStack, runExpo, runOffline, runServerless, stackOutputs} = require('./core.cjs');

function parse(argv) {
    const options = {}, positionals = [];
    for (let index = 0; index < argv.length; index++) {
        const value = argv[index];
        if (!value.startsWith('--')) { positionals.push(value); continue; }
        const [key, inline] = value.slice(2).split('=', 2);
        if (inline !== undefined) options[key] = inline;
        else if (argv[index + 1] && !argv[index + 1].startsWith('--')) options[key] = argv[++index];
        else options[key] = true;
    }
    return {positionals, options};
}
function required(options, name) { if (!options[name] || options[name] === true) throw new Error(`Supply --${name}.`); return options[name]; }
function help() {
    console.log(`Usage:
  aws-classify cloud publish --config cloud/serverless.yml --source web/dist [--stage dev] [--output cloud/output.json]
  aws-classify cloud deploy --config cloud/serverless.yml [--stage dev] [--publish --source web/dist]
  aws-classify cloud remove --config cloud/serverless.yml [--stage dev]
  aws-classify cloud offline --config cloud/serverless.yml [--web web] [--backend-only] [--debug] [--stage dev]
  aws-classify cloud db:init --config cloud/serverless.yml [--stage dev]
  aws-classify mobile expo --project mobile [--cloud-output cloud/output.json] [--local-api] -- <Expo arguments>`);
}
async function main(argv = process.argv.slice(2)) {
    const separator = argv.indexOf('--'); const commandArgs = separator < 0 ? argv : argv.slice(0, separator);
    const forwarded = separator < 0 ? [] : argv.slice(separator + 1);
    const {positionals, options} = parse(commandArgs);
    if (!positionals.length || options.help) return help();
    const [area, action] = positionals;
    const stage = options.stage || 'dev';
    if (area === 'cloud' && action === 'publish') {
        const result = await publishFromStack({config: required(options, 'config'), source: required(options, 'source'), stage, output: options.output, region: options.region});
        console.log(`Published ${result.files} files (${result.removed} removed) to https://${result.outputs.WebsiteUrl}.`); return;
    }
    if (area === 'cloud' && action === 'deploy') {
        const config = required(options, 'config'); await runServerless({config, stage, args: ['deploy', ...forwarded]});
        if (options.publish) {
            const result = await publishFromStack({config, source: required(options, 'source'), stage, output: options.output, region: options.region});
            console.log(`Published ${result.files} files (${result.removed} removed) to https://${result.outputs.WebsiteUrl}.`);
        }
        return;
    }
    if (area === 'cloud' && action === 'remove') {
        const config = required(options, 'config'), stack = await stackOutputs({config, stage, region: options.region});
        if (!stack.outputs.ContentBucket) throw new Error(`${stack.name} must output ContentBucket before it can be removed.`);
        await emptyBucket(stack.outputs.ContentBucket, {region: stack.region}); console.log(`Emptied ${stack.outputs.ContentBucket}.`);
        await runServerless({config, stage, args: ['remove', ...forwarded]}); return;
    }
    if (area === 'cloud' && action === 'offline') return runOffline({config: required(options, 'config'), stage, web: options.web, backendOnly: Boolean(options['backend-only']), debug: Boolean(options.debug)});
    if (area === 'cloud' && action === 'db:init') { const table = await initializeLocalDb({config: required(options, 'config'), stage}); console.log(`Local session table ready: ${table}`); return; }
    if (area === 'mobile' && action === 'expo') return runExpo({project: required(options, 'project'), cloudOutput: options['cloud-output'], localApi: Boolean(options['local-api']), expoArgs: forwarded});
    throw new Error(`Unknown command: ${positionals.join(' ')}`);
}
module.exports = {main, parse};
