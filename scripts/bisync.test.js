const assert = require('node:assert/strict');
const { test } = require('node:test');
const { once } = require('node:events');
const { mkdtemp, mkdir, writeFile, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { DirSync } = require('bisync/build/DirSync');

async function waitForContents(path, contents) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
        try { if (await readFile(path, 'utf8') === contents) return; }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        await delay(50);
    }
    assert.fail(`Source synchronization did not update ${path}`);
}

test('bisync still synchronizes directory and file edits with Chokidar 4', { timeout: 20000 }, async context => {
    const directory = await mkdtemp(join(tmpdir(), 'classify-bisync-'));
    const left = join(directory, 'left');
    const right = join(directory, 'right');
    const docsLeft = join(directory, 'docs-left');
    const docsRight = join(directory, 'docs-right');
    const readme1 = join(docsLeft, 'README.md');
    const readme2 = join(docsRight, 'README.md');
    const config = join(directory, 'bisync.json');
    const sync = new DirSync();
    const logs = [];
    sync.setLogger(message => logs.push(message));
    try {
        await Promise.all([mkdir(left), mkdir(right), mkdir(docsLeft), mkdir(docsRight)]);
        await Promise.all([mkdir(join(left, 'requests')), mkdir(join(right, 'requests'))]);
        await Promise.all([writeFile(readme1, ''), writeFile(readme2, '')]);
        await writeFile(config, JSON.stringify([[left, right], [readme1, readme2]]));
        await sync.setConfig(config);
        await once(sync.configs[config].watcher, 'ready', { signal: context.signal });

        await writeFile(join(left, 'requests', 'request.ts'), 'export const count = 1;');
        await waitForContents(join(right, 'requests', 'request.ts'), 'export const count = 1;');
        // Let the watcher consume the synchronization's own write before editing.
        await delay(250);
        await writeFile(join(right, 'requests', 'request.ts'), 'export const count = 2;');
        await waitForContents(join(left, 'requests', 'request.ts'), 'export const count = 2;');

        await writeFile(readme1, 'first version');
        await waitForContents(readme2, 'first version');
        await delay(250);
        await writeFile(readme2, 'second version');
        await waitForContents(readme1, 'second version');
    } catch (error) {
        error.message += `\nSource watcher output:\n${logs.join('\n')}`;
        throw error;
    } finally {
        await Promise.all(Object.values(sync.configs).map(entry => entry.watcher.close()));
        await rm(directory, { recursive: true, force: true });
    }
});
