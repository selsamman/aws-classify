import {cpSync, existsSync, mkdtempSync, readdirSync, rmSync} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
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
  const pushing = args[0] === 'push';
  const env = {...process.env, GIT_TERMINAL_PROMPT: '0'};
  // Do not fall back to IDE/password prompts or credential diagnostic logging.
  for (const key of ['GIT_ASKPASS', 'SSH_ASKPASS', 'GIT_TRACE', 'GIT_TRACE_CURL',
    'GIT_CURL_VERBOSE', 'GIT_TRACE_PACKET', 'GCM_TRACE', 'GCM_TRACE_SECRETS']) delete env[key];
  if (pushing) {
    if (!process.stdin.isTTY || !process.stderr.isTTY) {
      throw new Error('Publishing requires an interactive terminal for browser sign-in. Run npm run guide:publish in your terminal, rather than an IDE run configuration or unattended job.');
    }
    const gcm = ['git-credential-manager', path.join(homedir(), '.local/bin/git-credential-manager')]
      .find(candidate => spawnSync(candidate, ['--version'], {encoding: 'utf8', env}).status === 0);
    if (!gcm) {
      throw new Error('Browser sign-in requires Git Credential Manager. Install it using https://github.com/git-ecosystem/git-credential-manager/blob/main/docs/install.md and rerun npm run guide:publish.');
    }
    env.AWS_CLASSIFY_GCM = gcm;
    env.GCM_CREDENTIAL_STORE = 'none';
    env.GCM_GITHUB_AUTHMODES = 'browser';
    env.GCM_INTERACTIVE = 'true';
    env.GIT_TERMINAL_PROMPT = '1';
    console.log('Complete GitHub sign-in in the browser when it opens. GitHub applies its normal browser-session and MFA requirements.');
    console.log('This push uses Git Credential Manager with credential storage disabled; Keychain and your normal Git settings are unchanged.');
  }
  const result = spawnSync('git', [
    // Reset inherited helpers, then enable GCM only for this push, without storage.
    '-c', 'credential.helper=',
    '-c', 'core.askPass=',
    ...(pushing ? [
      '-c', 'credential.helper=!"$AWS_CLASSIFY_GCM"',
      '-c', 'credential.credentialStore=none',
      '-c', 'credential.gitHubAuthModes=browser',
    ] : []),
    ...args,
  ], {
    cwd, encoding: 'utf8', env,
    ...(pushing ? {stdio: 'inherit'} : {}),
  });
  if (result.error) throw result.error;
  if (!allowed.includes(result.status)) {
    throw new Error(`Git ${args[0]} failed: ${result.stderr?.trim() || `exit status ${result.status ?? 'unknown'}; see the Git output above`}`);
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
