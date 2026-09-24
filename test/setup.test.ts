import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FOLDER_ID, LIST_ID, rawList, runCli } from './helpers.ts';

test('whoami returns id, username and email', async () => {
  const run = await runCli(['whoami'], { config: null, routes: {
    'GET /user': { body: { user: { id: 7, username: 'jane', email: 'jane@example.com' } } },
  } });
  assert.equal(run.code, 0);
  assert.deepEqual(run.json(), { id: 7, username: 'jane', email: 'jane@example.com' });
});

test('folders flattens workspaces, spaces and folders', async () => {
  const run = await runCli(['folders'], { config: null, routes: {
    'GET /team': { body: { teams: [{ id: '1', name: 'Acme' }] } },
    'GET /team/1/space': { body: { spaces: [{ id: '2', name: 'Projects' }] } },
    'GET /space/2/folder': { body: { folders: [{ id: FOLDER_ID, name: 'Website' }] } },
  } });
  assert.deepEqual(run.json(), [{ id: FOLDER_ID, name: 'Website', space: 'Projects', workspace: 'Acme' }]);
});

test('init writes .taskwire.json after checking the folder and list', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'taskwire-init-'));
  const run = await runCli(['init', '--folder', FOLDER_ID, '--list', LIST_ID], { cwd, routes: {
    [`GET /folder/${FOLDER_ID}`]: { body: { id: FOLDER_ID, name: 'Website' } },
    [`GET /list/${LIST_ID}`]: { body: rawList() },
  } });
  assert.equal(run.code, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(cwd, '.taskwire.json'), 'utf8')), {
    provider: 'clickup',
    folderId: FOLDER_ID,
    defaultListId: LIST_ID,
  });
});

test('init refuses to overwrite an existing config without --force', async () => {
  const run = await runCli(['init', '--folder', FOLDER_ID], { routes: {
    [`GET /folder/${FOLDER_ID}`]: { body: { id: FOLDER_ID, name: 'P' } },
  } });
  assert.equal(run.code, 2);
  assert.match(JSON.parse(run.stderr).hint, /--force/);
});

test('init rejects a non numeric folder id before calling ClickUp', async () => {
  const run = await runCli(['init', '--folder', 'abc'], { config: null });
  assert.equal(run.code, 2);
  assert.equal(run.calls.length, 0);
});
