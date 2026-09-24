import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

const folderRoute = { [`GET /folder/${FOLDER_ID}`]: { body: { id: FOLDER_ID, name: 'Website', space: { id: '2' } } } };
const oneWorkspace = { 'GET /team': { body: { teams: [{ id: '1', name: 'Acme' }] } } };

test('init writes .taskwire.json after checking the folder and list, with the folder workspace', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'taskwire-init-'));
  const run = await runCli(['init', '--folder', FOLDER_ID, '--list', LIST_ID], { cwd, routes: {
    ...folderRoute,
    ...oneWorkspace,
    [`GET /list/${LIST_ID}`]: { body: rawList() },
  } });
  assert.equal(run.code, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(cwd, '.taskwire.json'), 'utf8')), {
    provider: 'clickup',
    workspaceId: '1',
    folderId: FOLDER_ID,
    defaultListId: LIST_ID,
  });
});

test('init finds the workspace of the folder among several', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'taskwire-init-'));
  const run = await runCli(['init', '--folder', FOLDER_ID], { cwd, routes: {
    ...folderRoute,
    'GET /team': { body: { teams: [{ id: '1', name: 'Acme' }, { id: '3', name: 'Other' }] } },
    'GET /team/1/space': { body: { spaces: [{ id: '8', name: 'Elsewhere' }] } },
    'GET /team/3/space': { body: { spaces: [{ id: '2', name: 'Projects' }] } },
  } });
  assert.equal(run.code, 0);
  assert.equal(JSON.parse(readFileSync(join(cwd, '.taskwire.json'), 'utf8')).workspaceId, '3');
  assert.equal((run.json() as { workspaceId: string }).workspaceId, '3');
});

test('init refuses to overwrite an existing config without --force', async () => {
  const run = await runCli(['init', '--folder', FOLDER_ID], { routes: { ...folderRoute, ...oneWorkspace } });
  assert.equal(run.code, 2);
  assert.match(JSON.parse(run.stderr).hint, /--force/);
});

test('init rejects a non numeric folder id before calling ClickUp', async () => {
  const run = await runCli(['init', '--folder', 'abc'], { config: null });
  assert.equal(run.code, 2);
  assert.equal(run.calls.length, 0);
});

test('an invalid .taskwire.json does not block init --force from repairing it', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'taskwire-broken-'));
  writeFileSync(join(cwd, '.taskwire.json'), '{"folderId": 900}');
  const run = await runCli(['init', '--folder', FOLDER_ID, '--force'], { cwd, routes: { ...folderRoute, ...oneWorkspace } });
  assert.equal(run.code, 0);
  assert.equal(JSON.parse(readFileSync(join(cwd, '.taskwire.json'), 'utf8')).folderId, FOLDER_ID);
});

test('an invalid .taskwire.json does not block whoami', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'taskwire-broken-'));
  writeFileSync(join(cwd, '.taskwire.json'), '{nope');
  const run = await runCli(['whoami'], { cwd, routes: {
    'GET /user': { body: { user: { id: 7, username: 'jane', email: 'jane@example.com' } } },
  } });
  assert.equal(run.code, 0);
});

test('init --force keeps the task conventions of the existing config', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'taskwire-init-'));
  const conventions = { language: 'Italian', instructions: 'Names in the imperative.' };
  writeFileSync(join(cwd, '.taskwire.json'), JSON.stringify({ folderId: '1', conventions }));
  const run = await runCli(['init', '--folder', FOLDER_ID, '--force'], { cwd, routes: { ...folderRoute, ...oneWorkspace } });
  assert.equal(run.code, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(cwd, '.taskwire.json'), 'utf8')), {
    provider: 'clickup',
    workspaceId: '1',
    folderId: FOLDER_ID,
    conventions,
  });
});
