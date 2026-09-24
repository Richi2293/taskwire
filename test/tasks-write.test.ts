import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LIST_ID, OTHER_FOLDER_ID, rawList, rawTask, runCli } from './helpers.ts';

const listRoute = { [`GET /list/${LIST_ID}`]: { body: rawList() } };

test('task create sends only the given fields to the default list', async () => {
  const run = await runCli(
    ['task', 'create', '--name', 'New', '--status', 'In Progress', '--priority', 'high', '--tag', 'backend', '--tag', 'customer feedback', '--due', '2026-01-15'],
    { routes: { ...listRoute, [`POST /list/${LIST_ID}/task`]: { body: rawTask({ id: 'n1', name: 'New' }) } } },
  );
  assert.equal(run.code, 0);
  const post = run.calls.find((c) => c.method === 'POST');
  assert.deepEqual(post?.body, {
    name: 'New',
    status: 'in progress',
    priority: 2,
    tags: ['backend', 'customer feedback'],
    due_date: new Date(2026, 0, 15).getTime(), // local midnight, whatever TZ the tests run in
    due_date_time: false,
  });
  assert.equal((run.json() as { id: string }).id, 'n1');
});

test('task create reads a markdown description from a file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'taskwire-desc-'));
  const file = join(dir, 'desc.md');
  writeFileSync(file, '# Title\n\n- "quoted" item\n');
  const run = await runCli(['task', 'create', '--name', 'N', '--description-file', file], { routes: {
    ...listRoute, [`POST /list/${LIST_ID}/task`]: { body: rawTask() },
  } });
  assert.equal(run.code, 0);
  assert.equal((run.calls[1].body as { markdown_content: string }).markdown_content, '# Title\n\n- "quoted" item\n');
});

test('task create with a missing description file exits 2 without calling ClickUp', async () => {
  const run = await runCli(['task', 'create', '--name', 'N', '--description-file', '/nope/missing.md']);
  assert.equal(run.code, 2);
  assert.match(JSON.parse(run.stderr).error, /missing\.md/);
  assert.equal(run.calls.length, 0);
});

test('task create with both description flags exits 2', async () => {
  const run = await runCli(['task', 'create', '--name', 'N', '--description', 'a', '--description-file', 'b']);
  assert.equal(run.code, 2);
});

test('task create with an unknown status lists the valid ones', async () => {
  const run = await runCli(['task', 'create', '--name', 'N', '--status', 'doing'], { routes: listRoute });
  assert.equal(run.code, 2);
  assert.match(JSON.parse(run.stderr).hint, /to do, in progress, complete/);
});

test('task create with --parent defaults to the parent list and checks the parent folder', async () => {
  const run = await runCli(['task', 'create', '--name', 'Sub', '--parent', 'p1'], {
    config: { provider: 'clickup', folderId: '900' },
    routes: {
      'GET /task/p1': { body: rawTask({ id: 'p1' }) },
      ...listRoute,
      [`POST /list/${LIST_ID}/task`]: { body: rawTask({ id: 's1', parent: 'p1' }) },
    },
  });
  assert.equal(run.code, 0);
  assert.equal((run.calls.at(-1)?.body as { parent: string }).parent, 'p1');
});

test('task create without a list and without defaultListId exits 2', async () => {
  const run = await runCli(['task', 'create', '--name', 'N'], { config: { provider: 'clickup', folderId: '900' } });
  assert.equal(run.code, 2);
  assert.equal(run.calls.length, 0);
});

test('task update changes fields, encodes tag names and returns the fresh task', async () => {
  const run = await runCli(
    ['task', 'update', 't1', '--status', 'complete', '--add-tag', 'customer feedback', '--remove-tag', 'old', '--add-assignee', '7'],
    { routes: {
      'GET /task/t1': { body: rawTask({ status: { status: 'complete' } }) },
      ...listRoute,
      'PUT /task/t1': { body: rawTask() },
      'POST /task/t1/tag/customer%20feedback': { body: {} },
      'DELETE /task/t1/tag/old': { body: {} },
    } },
  );
  assert.equal(run.code, 0);
  const put = run.calls.find((c) => c.method === 'PUT');
  assert.deepEqual(put?.body, { status: 'complete', assignees: { add: [7], rem: [] } });
  const tagCall = run.calls.find((c) => c.method === 'POST');
  assert.equal(tagCall?.url.pathname, '/api/v2/task/t1/tag/customer%20feedback');
  assert.equal((run.json() as { status: string }).status, 'complete');
});

test('task update with nothing to change exits 2', async () => {
  const run = await runCli(['task', 'update', 't1']);
  assert.equal(run.code, 2);
  assert.equal(run.calls.length, 0);
});

test('task update of a task in another folder exits 3 without writing', async () => {
  const run = await runCli(['task', 'update', 't1', '--name', 'X'], { routes: {
    'GET /task/t1': { body: rawTask({ folder: { id: OTHER_FOLDER_ID, name: 'Other' } }) },
  } });
  assert.equal(run.code, 3);
  assert.equal(run.calls.filter((c) => c.method !== 'GET').length, 0);
});

test('task delete without --yes exits 2 and makes no call', async () => {
  const run = await runCli(['task', 'delete', 't1']);
  assert.equal(run.code, 2);
  assert.equal(run.calls.length, 0);
});

test('task delete --yes checks the folder then deletes', async () => {
  const run = await runCli(['task', 'delete', 't1', '--yes'], { routes: {
    'GET /task/t1': { body: rawTask() },
    'DELETE /task/t1': { status: 204 },
  } });
  assert.equal(run.code, 0);
  assert.deepEqual(run.json(), { deleted: 't1', name: 'Task one' });
});
