import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FOLDER_ID, LIST_ID, rawList, runCli } from './helpers.ts';

test('lists returns each list of the project folder with its statuses', async () => {
  const run = await runCli(['lists'], { routes: {
    [`GET /folder/${FOLDER_ID}/list`]: { body: { lists: [{ id: LIST_ID, name: 'Backlog' }] } },
    [`GET /list/${LIST_ID}`]: { body: rawList() },
  } });
  assert.equal(run.code, 0);
  assert.deepEqual(run.json(), [{ id: LIST_ID, name: 'Backlog', statuses: ['to do', 'in progress', 'complete'] }]);
});

test('list create posts the name into the project folder', async () => {
  const run = await runCli(['list', 'create', '--name', 'Sprint 1'], { routes: {
    [`POST /folder/${FOLDER_ID}/list`]: { body: rawList({ id: '801', name: 'Sprint 1' }) },
  } });
  assert.equal(run.code, 0);
  assert.deepEqual(run.calls[0].body, { name: 'Sprint 1' });
  assert.equal((run.json() as { id: string }).id, '801');
});

test('a project command without .taskwire.json exits 3 with the init hint', async () => {
  const run = await runCli(['lists'], { config: null });
  assert.equal(run.code, 3);
  assert.match(JSON.parse(run.stderr).hint, /taskwire init --folder/);
  assert.equal(run.calls.length, 0);
});

test('list create without --name exits 2', async () => {
  const run = await runCli(['list', 'create']);
  assert.equal(run.code, 2);
  assert.equal(run.calls.length, 0);
});
