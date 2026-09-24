import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FOLDER_ID, runCli } from './helpers.ts';

test('conventions prints the task conventions of the project without calling the provider', async () => {
  const run = await runCli(['conventions'], { config: {
    provider: 'clickup',
    folderId: FOLDER_ID,
    conventions: { language: 'Italian', instructions: 'Names in the imperative.' },
  } });
  assert.equal(run.code, 0);
  assert.deepEqual(run.json(), { language: 'Italian', instructions: 'Names in the imperative.' });
  assert.equal(run.calls.length, 0);
});

test('conventions returns nulls when the project sets none', async () => {
  const run = await runCli(['conventions']);
  assert.equal(run.code, 0);
  assert.deepEqual(run.json(), { language: null, instructions: null });
});

test('conventions needs a .taskwire.json', async () => {
  const run = await runCli(['conventions'], { config: null });
  assert.equal(run.code, 3);
});
