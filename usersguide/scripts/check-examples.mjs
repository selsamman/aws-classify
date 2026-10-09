import './prepare-downloads.mjs';
import {readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const guide = fileURLToPath(new URL('..', import.meta.url));
const repo = path.dirname(guide);
const require = createRequire(path.join(guide, 'package.json'));
const ts = require('typescript');
const yaml = require('js-yaml');
const reports = path.join(repo, '.test-results');
mkdirSync(reports, {recursive: true});
const temp = mkdtempSync(path.join(reports, 'guide-examples-'));
const files = [];

function visit(directory) {
  for (const entry of readdirSync(directory, {withFileTypes: true})) {
    const source = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(source);
    else if (/\.mdx?$/.test(entry.name)) {
      const text = readFileSync(source, 'utf8');
      for (const match of text.matchAll(/```(ts|json) title="([^"]+)"\n([\s\S]*?)\n```/g)) {
        const filename = match[2];
        if (filename.includes('..') || path.isAbsolute(filename)) throw new Error('Unsafe example path');
        const target = path.join(temp, filename);
        mkdirSync(path.dirname(target), {recursive: true});
        writeFileSync(target, match[3] + '\n');
        if (match[1] === 'json') JSON.parse(match[3]);
        else files.push(target);
      }
    }
  }
}

try {
  visit(path.join(guide, 'content'));
  // Later chapters explicitly ask readers to export each added request.
  const requestDir = path.join(temp, 'common/requests');
  const requestFiles = readdirSync(requestDir).filter(name => name.endsWith('.ts') && name !== 'index.ts');
  writeFileSync(path.join(requestDir, 'index.ts'), requestFiles.map(name =>
    `export * from './${name.slice(0, -3)}';`).join('\n'));

  for (const name of ['client', 'server', 'common']) {
    readFileSync(path.join(repo, `aws-classify-${name}/lib/esm/index.d.ts`));
  }
  const options = {
    target: ts.ScriptTarget.ES2021,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    strict: true, noEmit: true, esModuleInterop: true, skipLibCheck: true,
    types: ['node'], typeRoots: [path.join(guide, 'node_modules/@types')],
    baseUrl: repo,
    paths: {
      '@my-app/requests': [path.join(temp, 'common/requests/index.ts')],
      'aws-classify-client': ['aws-classify-client/lib/esm/index.d.ts'],
      'aws-classify-server': ['aws-classify-server/lib/esm/index.d.ts'],
      'aws-classify-common': ['aws-classify-common/lib/esm/index.d.ts'],
    },
  };
  const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram(files, options));
  if (diagnostics.length) {
    console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: x => x, getCurrentDirectory: () => repo, getNewLine: () => '\n',
    }));
    process.exitCode = 1;
  } else console.log(`Typechecked ${files.length} complete tutorial files; package JSON and downloadable YAML checked.`);

  for (const filename of ['serverless.yml', 'serverless-authenticated.yml']) {
    const config = readFileSync(path.join(guide, 'static/config', filename), 'utf8');
    const parsed = yaml.load(config);
    if (parsed.frameworkVersion !== '4' || !parsed.functions || !parsed.resources) {
      throw new Error(`Incomplete Serverless configuration in ${filename}`);
    }
    const includes = [...config.matchAll(/\$\{file\(\$\{self:custom\.yml\}\/([^\)]+)\)\}/g)];
    for (const match of includes) readFileSync(path.join(repo, 'aws-classify-server/yml', match[1]));
    if (!config.includes('DOMAIN: ${self:custom.domainName}') || !config.includes('DD_REGION: ${self:provider.region}')) {
      throw new Error(`Incomplete environment in ${filename}`);
    }
  }
} finally {
  rmSync(temp, {recursive: true, force: true});
}
