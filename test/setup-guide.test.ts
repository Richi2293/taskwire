import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FOLDER_ID, LIST_ID, rawList, runCli } from './helpers.ts';

const GUIDE = readFileSync(new URL('../rules/setup.md', import.meta.url), 'utf8');
const AGENTS_BLOCK = readFileSync(new URL('../rules/agents-block.md', import.meta.url), 'utf8');
const PACKAGE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { name: string; version: string };
const DIST_TAGS = `GET /-/package/${PACKAGE.name.replace('/', '%2f')}/dist-tags`;

interface SetupOut {
  version: string;
  configured: string | null;
  guide: string;
  agentsBlock: string;
  update: { latest: string; command: string } | null;
}

test('setup prints the guide and the AGENTS.md block without a token, a config or a provider call', async () => {
  const run = await runCli(['setup'], { config: null, keychain: null });
  assert.equal(run.code, 0);
  const out = run.json() as SetupOut;
  assert.equal(out.version, PACKAGE.version);
  assert.equal(out.configured, null);
  assert.equal(out.guide, GUIDE);
  assert.equal(out.agentsBlock, AGENTS_BLOCK);
  assert.equal(out.update, null);
  assert.equal(run.calls.length, 0);
});

test('setup reports the config of the project, also when it is in a parent folder', async () => {
  const root = mkdtempSync(join(tmpdir(), 'taskwire-setup-'));
  writeFileSync(join(root, '.taskwire.json'), JSON.stringify({ provider: 'clickup', folderId: FOLDER_ID }));
  const sub = join(root, 'packages', 'app');
  mkdirSync(sub, { recursive: true });
  const run = await runCli(['setup'], { cwd: sub });
  assert.equal((run.json() as SetupOut).configured, join(root, '.taskwire.json'));
});

test('setup still works when the config is broken, so the agent can repair it', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'taskwire-setup-'));
  writeFileSync(join(cwd, '.taskwire.json'), '{nope');
  const run = await runCli(['setup'], { cwd });
  assert.equal(run.code, 0);
  assert.equal((run.json() as SetupOut).configured, join(cwd, '.taskwire.json'));
});

test('setup reports a newer taskwire on npm', async () => {
  const run = await runCli(['setup'], {
    config: null,
    keychain: null,
    env: { XDG_CACHE_HOME: mkdtempSync(join(tmpdir(), 'taskwire-cache-')) },
    routes: { [DIST_TAGS]: { body: { latest: '99.0.0' } } },
  });
  assert.deepEqual((run.json() as SetupOut).update, { latest: '99.0.0', command: `npm i -g ${PACKAGE.name}@latest` });
});

test('setup --pretty prints the guide and the block as markdown', async () => {
  const run = await runCli(['setup', '--pretty'], { config: null, keychain: null });
  assert.equal(run.code, 0);
  assert.ok(run.stdout.includes(GUIDE.trim()));
  assert.ok(run.stdout.includes(AGENTS_BLOCK.trim()));
  assert.match(run.stdout, /Configured: no/);
});

test('the AGENTS.md block tells agents to run taskwire rules and how to install taskwire', () => {
  assert.match(AGENTS_BLOCK, /^## Project tasks \(taskwire\)/);
  assert.match(AGENTS_BLOCK, /`taskwire rules`/);
  assert.match(AGENTS_BLOCK, /npm install --global @richi2293\/taskwire/);
});

test('the AGENTS.md block tells agents to move a task in progress before working on it', () => {
  assert.match(AGENTS_BLOCK, /move it to in progress as your first step/);
});

test('a command that needs the config points to taskwire setup when it is missing', async () => {
  const run = await runCli(['rules'], { config: null });
  assert.equal(run.code, 3);
  assert.match(JSON.parse(run.stderr).hint, /taskwire setup/);
});

test('lists --folder shows the lists of any folder without a config', async () => {
  const run = await runCli(['lists', '--folder', FOLDER_ID], { config: null, routes: {
    [`GET /folder/${FOLDER_ID}/list`]: { body: { lists: [{ id: LIST_ID, name: 'Backlog' }] } },
    [`GET /list/${LIST_ID}`]: { body: rawList() },
  } });
  assert.equal(run.code, 0);
  assert.deepEqual(run.json(), [{
    id: LIST_ID,
    name: 'Backlog',
    statuses: ['to do', 'in progress', 'complete'],
    flow: { backlog: 'to do', todo: null, inProgress: 'in progress', review: null, closed: 'complete' },
  }]);
});

test('lists --folder rejects a non numeric folder id before calling the provider', async () => {
  const run = await runCli(['lists', '--folder', 'abc'], { config: null });
  assert.equal(run.code, 2);
  assert.equal(run.calls.length, 0);
});

test('lists without --folder still needs the config', async () => {
  const run = await runCli(['lists'], { config: null });
  assert.equal(run.code, 3);
  assert.match(JSON.parse(run.stderr).hint, /taskwire setup/);
});

const folderRoute = { [`GET /folder/${FOLDER_ID}`]: { body: { id: FOLDER_ID, name: 'Website', space: { id: '2' } } } };
const oneWorkspace = { 'GET /team': { body: { teams: [{ id: '1', name: 'Acme' }] } } };

test('init --language and --instructions write the project conventions', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'taskwire-init-'));
  const run = await runCli(['init', '--folder', FOLDER_ID, '--language', 'Italian', '--instructions', 'Close tasks after the merge.'], {
    cwd,
    routes: { ...folderRoute, ...oneWorkspace },
  });
  assert.equal(run.code, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(cwd, '.taskwire.json'), 'utf8')).conventions, {
    language: 'Italian',
    instructions: 'Close tasks after the merge.',
  });
});

test('init --force --language keeps the other conventions', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'taskwire-init-'));
  writeFileSync(join(cwd, '.taskwire.json'), JSON.stringify({
    provider: 'clickup',
    folderId: FOLDER_ID,
    conventions: { language: 'English', instructions: 'Keep it short.', rulesFile: 'docs/task-rules.md' },
  }));
  const run = await runCli(['init', '--folder', FOLDER_ID, '--force', '--language', 'Italian'], { cwd, routes: { ...folderRoute, ...oneWorkspace } });
  assert.equal(run.code, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(cwd, '.taskwire.json'), 'utf8')).conventions, {
    language: 'Italian',
    instructions: 'Keep it short.',
    rulesFile: 'docs/task-rules.md',
  });
});

test('init rejects an empty --language before calling the provider', async () => {
  const run = await runCli(['init', '--folder', FOLDER_ID, '--language', ' '], { config: null });
  assert.equal(run.code, 2);
  assert.equal(run.calls.length, 0);
});
