import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCli, sequence } from './helpers.ts';

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

test('global flags may come before the command', async () => {
  const run = await runCli(['--pretty', 'whoami'], { routes: {
    'GET /user': { body: { user: { id: 7, username: 'jane' } } },
  } });
  assert.equal(run.code, 0);
  assert.match(run.stdout, /\n  "id": 7/);
});

test('an option with a value before the command is a usage error', async () => {
  const run = await runCli(['--list', '800', 'tasks']);
  assert.equal(run.code, 2);
  assert.equal(run.calls.length, 0);
  assert.match(JSON.parse(run.stderr).error, /Options must come after the command/);
});

test('extra arguments for a command without arguments are a usage error', async () => {
  const run = await runCli(['tasks', 'backend']);
  assert.equal(run.code, 2);
  assert.equal(run.calls.length, 0);
  assert.match(JSON.parse(run.stderr).error, /Unexpected argument "backend"/);
});

test('a second id for a command that takes one is a usage error', async () => {
  const run = await runCli(['task', 'get', 't1', 't2']);
  assert.equal(run.code, 2);
  assert.equal(run.calls.length, 0);
  assert.match(JSON.parse(run.stderr).error, /Unexpected argument "t2"/);
});

test('a rate limit wait is reported on stderr and the command still succeeds', async () => {
  const run = await runCli(['whoami'], { routes: {
    'GET /user': sequence({ status: 429 }, { body: { user: { id: 7, username: 'jane' } } }),
  } });
  assert.equal(run.code, 0);
  assert.equal((run.json() as { id: number }).id, 7);
  assert.deepEqual(JSON.parse(run.stderr), { warning: 'ClickUp rate limit reached, waiting 60 seconds' });
});
