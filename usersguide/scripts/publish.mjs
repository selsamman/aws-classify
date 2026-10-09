import {cpSync, existsSync, mkdtempSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import config from '../docusaurus.config.js';

const guide = fileURLToPath(new URL('..', import.meta.url));
const build = path.join(guide, 'build');
const branch = config.deploymentBranch;
if (!/^[\w-]+$/.test(config.organizationName) || !/^[\w.-]+$/.test(config.projectName) || branch !== 'gh-pages') {
  throw new Error('Publication requires a configured GitHub project and gh-pages branch.');
}
if (!existsSync(path.join(build, 'index.html'))) throw new Error('Build the guide before publishing.');
const remote = `https://github.com/${config.organizationName}/${config.projectName}.git`;
const temp = mkdtempSync(path.join(tmpdir(), 'aws-classify-guide-'));

function git(args, cwd = temp, allowed = [0]) {
  const result = spawnSync('git', args, {
    cwd, encoding: 'utf8', env: {...process.env, GIT_TERMINAL_PROMPT: '0'},
  });
  if (result.error) throw result.error;
  if (!allowed.includes(result.status)) {
    throw new Error(`Git ${args[0]} failed: ${result.stderr.trim()}`);
  }
  return result;
}

try {
  const existing = git(['ls-remote', '--exit-code', '--heads', remote, branch], guide, [0, 2]);
  git(['init', '--quiet']);
  git(['remote', 'add', 'origin', remote]);
  if (existing.status === 0) {
    git(['fetch', '--quiet', '--depth', '1', 'origin', branch]);
    git(['checkout', '--quiet', '-b', branch, 'FETCH_HEAD']);
  } else git(['checkout', '--quiet', '-b', branch]);

  // Use the maintainer's existing commit identity without changing repository config.
  for (const key of ['user.name', 'user.email']) {
    const value = git(['config', '--get', key], guide, [0, 1]).stdout.trim();
    if (value) git(['config', key, value]);
  }
  for (const entry of readdirSync(temp)) {
    if (entry !== '.git') rmSync(path.join(temp, entry), {recursive: true, force: true});
  }
  cpSync(build, temp, {recursive: true});
  git(['add', '--all']);
  const changed = git(['diff', '--cached', '--quiet'], temp, [0, 1]);
  if (changed.status === 0) console.log('Published guide already matches this build.');
  else {
    git(['commit', '--quiet', '-m', 'Publish aws-classify user guide']);
    // A normal push preserves history and refuses to overwrite concurrent publication.
    git(['push', 'origin', branch]);
    console.log(`Pushed generated guide to ${branch}. Configure/verify Pages at ${config.url}${config.baseUrl}`);
  }
} finally {
  rmSync(temp, {recursive: true, force: true});
}
