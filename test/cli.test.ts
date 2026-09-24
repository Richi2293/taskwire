import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from './helpers.ts';

test('no command prints help and exits 0', async () => {
  const run = await runCli([]);
  assert.equal(run.code, 0);
  assert.match(run.stdout, /taskwire: manage the tasks of this project/);
});

test('--help prints help even with a command', async () => {
  const run = await runCli(['whoami', '--help']);
  assert.equal(run.code, 0);
  assert.equal(run.calls.length, 0);
});

test('unknown command exits 2 with a JSON error', async () => {
  const run = await runCli(['frobnicate']);
  assert.equal(run.code, 2);
  assert.match(JSON.parse(run.stderr).error, /Unknown command "frobnicate"/);
});

test('unknown option exits 2', async () => {
  const run = await runCli(['whoami', '--bogus']);
  assert.equal(run.code, 2);
});

test('missing token exits 3 without calling ClickUp', async () => {
  const run = await runCli(['whoami'], { keychain: null });
  assert.equal(run.code, 3);
  assert.equal(run.calls.length, 0);
});

test('the token never appears in output, even when ClickUp echoes it back', async () => {
  const run = await runCli(['whoami'], {
    routes: { 'GET /user': { status: 400, body: { err: 'bad token pk_test_token', ECODE: 'X' } } },
  });
  assert.equal(run.code, 1);
  assert.equal(run.stderr.includes('pk_test_token'), false);
  assert.equal(run.stdout.includes('pk_test_token'), false);
});

test('--help taken as the value of an option is a usage error, not help', async () => {
  const run = await runCli(['tasks', '--tag', '--help']);
  assert.equal(run.code, 2);
  assert.equal(run.stdout, '');
  assert.match(JSON.parse(run.stderr).error, /ambiguous/);
});
