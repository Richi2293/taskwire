import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FOLDER_ID, LIST_ID, WORKSPACE_ID, rawTask, runCli } from './helpers.ts';

const keychains = { taskwire: 'pk_default', 'taskwire:acme': 'pk_acme', 'taskwire:globex': 'pk_globex' };
const project = { provider: 'clickup' as const, workspaceId: WORKSPACE_ID, folderId: FOLDER_ID, defaultListId: LIST_ID, account: 'acme' };
const userRoute = { 'GET /user': { body: { user: { id: 7, username: 'jane', email: 'jane@example.com' } } } };
const initRoutes = {
  [`GET /folder/${FOLDER_ID}`]: { body: { id: FOLDER_ID, name: 'Website', space: { id: '50' } } },
  'GET /team': { body: { teams: [{ id: WORKSPACE_ID, name: 'Acme' }] } },
};

test('a project with an account uses the token of that account', async () => {
  const run = await runCli(['task', 'get', 't1', '--comments', '0'], { config: project, keychains, routes: {
    'GET /task/t1': { body: rawTask() },
  } });
  assert.equal(run.code, 0);
  assert.deepEqual(run.calls.map((c) => c.token), ['pk_acme']);
});

test('a project without an account keeps using the default token', async () => {
  const run = await runCli(['whoami'], { keychains, routes: userRoute });
  assert.equal(run.code, 0);
  assert.deepEqual(run.calls.map((c) => c.token), ['pk_default']);
  assert.equal((run.json() as { account: string | null }).account, null);
});

test('--account wins over the project account and shows in whoami', async () => {
  const run = await runCli(['whoami', '--account', 'globex'], { config: project, keychains, routes: userRoute });
  assert.equal(run.code, 0);
  assert.deepEqual(run.calls.map((c) => c.token), ['pk_globex']);
  assert.equal((run.json() as { account: string }).account, 'globex');
});

test('--account works before init, when the project has no config', async () => {
  const run = await runCli(['whoami', '--account', 'acme'], { config: null, keychains, routes: userRoute });
  assert.equal(run.code, 0);
  assert.deepEqual(run.calls.map((c) => c.token), ['pk_acme']);
});

test('an account without a token fails with exit 3 and calls nothing', async () => {
  const run = await runCli(['whoami', '--account', 'initech'], { config: null, keychains });
  assert.equal(run.code, 3);
  assert.match(JSON.parse(run.stderr).error, /"initech"/);
  assert.equal(run.calls.length, 0);
});

test('an invalid --account exits 2 without calling ClickUp', async () => {
  const run = await runCli(['whoami', '--account', 'Acme Corp'], { config: null, keychains });
  assert.equal(run.code, 2);
  assert.equal(run.calls.length, 0);
});

test('init --account writes the account in the config', async () => {
  const run = await runCli(['init', '--folder', FOLDER_ID, '--account', 'acme'], { config: null, keychains, routes: initRoutes });
  assert.equal(run.code, 0);
  assert.deepEqual(run.calls.map((c) => c.token), ['pk_acme', 'pk_acme']);
  const written = JSON.parse(readFileSync(join(run.cwd, '.taskwire.json'), 'utf8')) as { account?: string };
  assert.equal(written.account, 'acme');
});

test('init --force keeps the account of the config and uses its token', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'taskwire-account-'));
  writeFileSync(join(cwd, '.taskwire.json'), JSON.stringify(project));
  const run = await runCli(['init', '--folder', FOLDER_ID, '--force'], { cwd, keychains, routes: initRoutes });
  assert.equal(run.code, 0);
  assert.deepEqual(run.calls.map((c) => c.token), ['pk_acme', 'pk_acme']);
  const written = JSON.parse(readFileSync(join(cwd, '.taskwire.json'), 'utf8')) as { account?: string };
  assert.equal(written.account, 'acme');
});
