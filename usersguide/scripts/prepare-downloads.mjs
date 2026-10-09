import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
export function prepareDownloads() {
  const output = path.join(root, 'static/config');
  mkdirSync(output, {recursive: true});
  for (const [page, filename] of [
    ['getting-started/deployment.md', 'serverless.yml'],
    ['guides/authentication.md', 'serverless-authenticated.yml'],
  ]) {
    const text = readFileSync(path.join(root, 'content', page), 'utf8');
    const block = text.match(new RegExp('```yaml title="cloud/' + filename.replaceAll('.', '\\.') + '"\\n([\\s\\S]*?)\\n```'));
    if (!block) throw new Error(`Missing downloadable configuration in ${page}`);
    writeFileSync(path.join(output, filename), block[1] + '\n');
  }
}
prepareDownloads();
