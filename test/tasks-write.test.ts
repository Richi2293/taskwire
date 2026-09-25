import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LIST_ID, OTHER_FOLDER_ID, WORKSPACE_ID, rawList, rawTask, runCli, sequence } from './helpers.ts';

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

test('task update clears the due date and the priority with "none"', async () => {
  const run = await runCli(['task', 'update', 't1', '--due', 'none', '--priority', 'None'], { routes: {
    'GET /task/t1': { body: rawTask() },
    'PUT /task/t1': { body: rawTask() },
  } });
  assert.equal(run.code, 0);
  const put = run.calls.find((c) => c.method === 'PUT');
  assert.deepEqual(put?.body, { due_date: null, priority: null });
});

test('task create rejects "none" as due date and priority', async () => {
  for (const args of [['--due', 'none'], ['--priority', 'none']]) {
    const run = await runCli(['task', 'create', '--name', 'N', ...args]);
    assert.equal(run.code, 2);
    assert.match(JSON.parse(run.stderr).hint, /only with task update/);
    assert.equal(run.calls.length, 0);
  }
});

const OTHER_LIST_ID = '801';
const otherListRoute = { [`GET /list/${OTHER_LIST_ID}`]: { body: rawList({ id: OTHER_LIST_ID, name: 'Doing', statuses: [{ status: 'review', type: 'custom' }] }) } };
const moveRoute = `PUT /v3/workspaces/${WORKSPACE_ID}/tasks/t1/home_list/${OTHER_LIST_ID}`;

test('task update --list moves the task with the v3 api after checking both folders', async () => {
  const run = await runCli(['task', 'update', 't1', '--list', OTHER_LIST_ID], { routes: {
    'GET /task/t1': sequence({ body: rawTask() }, { body: rawTask({ list: { id: OTHER_LIST_ID, name: 'Doing' } }) }),
    ...otherListRoute,
    [moveRoute]: { body: { data: { task_id: 't1', new_list_id: OTHER_LIST_ID } } },
  } });
  assert.equal(run.code, 0);
  assert.equal(run.calls.filter((c) => c.method === 'PUT').length, 1);
  assert.equal((run.json() as { list: { id: string } }).list.id, OTHER_LIST_ID);
});

test('task update --list with --status matches the status in the target list and sets it after the move', async () => {
  const run = await runCli(['task', 'update', 't1', '--list', OTHER_LIST_ID, '--status', 'Review'], { routes: {
    'GET /task/t1': { body: rawTask() },
    ...otherListRoute,
    [moveRoute]: { body: { data: {} } },
    'PUT /task/t1': { body: rawTask() },
  } });
  assert.equal(run.code, 0);
  const writes = run.calls.filter((c) => c.method === 'PUT');
  assert.deepEqual(writes.map((c) => c.path), [moveRoute.slice(4), '/task/t1']);
  assert.deepEqual(writes[1].body, { status: 'review' });
});

test('task update --list reports the move as applied when the field update fails', async () => {
  const run = await runCli(['task', 'update', 't1', '--list', OTHER_LIST_ID, '--name', 'Renamed'], { routes: {
    'GET /task/t1': { body: rawTask() },
    ...otherListRoute,
    [moveRoute]: { body: { data: {} } },
    'PUT /task/t1': { status: 500, body: { err: 'Internal error' } },
  } });
  assert.equal(run.code, 1);
  assert.equal(JSON.parse(run.stderr).hint, 'Applied: move to list "Doing". Not applied: fields');
});

test('task update --list of a subtask exits 2 without writing', async () => {
  const run = await runCli(['task', 'update', 't1', '--list', OTHER_LIST_ID], { routes: {
    'GET /task/t1': { body: rawTask({ parent: 'p1' }) },
    ...otherListRoute,
  } });
  assert.equal(run.code, 2);
  assert.match(JSON.parse(run.stderr).hint, /parent/);
  assert.equal(run.calls.filter((c) => c.method !== 'GET').length, 0);
});

test('task update --list to a list in another folder exits 3 without writing', async () => {
  const run = await runCli(['task', 'update', 't1', '--list', OTHER_LIST_ID], { routes: {
    'GET /task/t1': { body: rawTask() },
    [`GET /list/${OTHER_LIST_ID}`]: { body: rawList({ id: OTHER_LIST_ID, folder: { id: OTHER_FOLDER_ID, name: 'Other' } }) },
  } });
  assert.equal(run.code, 3);
  assert.equal(run.calls.filter((c) => c.method !== 'GET').length, 0);
});

test('task update --parent makes the task a subtask of a task in the project', async () => {
  const run = await runCli(['task', 'update', 't1', '--parent', '#p2'], { routes: {
    'GET /task/t1': { body: rawTask() },
    'GET /task/p2': { body: rawTask({ id: 'p2' }) },
    'PUT /task/t1': { body: rawTask({ parent: 'p2' }) },
  } });
  assert.equal(run.code, 0);
  assert.deepEqual(run.calls.find((c) => c.method === 'PUT')?.body, { parent: 'p2' });
});

test('task update --parent with a parent in another folder exits 3 without writing', async () => {
  const run = await runCli(['task', 'update', 't1', '--parent', 'p2'], { routes: {
    'GET /task/t1': { body: rawTask() },
    'GET /task/p2': { body: rawTask({ id: 'p2', folder: { id: OTHER_FOLDER_ID, name: 'Other' } }) },
  } });
  assert.equal(run.code, 3);
  assert.equal(run.calls.filter((c) => c.method !== 'GET').length, 0);
});

test('task update rejects invalid parent and list combinations without calling ClickUp', async () => {
  const cases: [string[], RegExp][] = [
    [['--parent', 't1'], /itself/],
    [['--parent', '#t1'], /itself/],
    [['--parent', 'none'], /ClickUp UI/],
    [['--parent', 'p2', '--list', OTHER_LIST_ID], /either --list or --parent/],
  ];
  for (const [args, message] of cases) {
    const run = await runCli(['task', 'update', 't1', ...args]);
    assert.equal(run.code, 2, args.join(' '));
    const error = JSON.parse(run.stderr) as { error: string; hint?: string };
    assert.match(`${error.error} ${error.hint ?? ''}`, message);
    assert.equal(run.calls.length, 0);
  }
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

test('task update reports what was applied when a tag call fails after the fields', async () => {
  const run = await runCli(
    ['task', 'update', 't1', '--name', 'Renamed', '--add-tag', 'backend', '--add-tag', 'urgent', '--remove-tag', 'old'],
    { routes: {
      'GET /task/t1': { body: rawTask() },
      'PUT /task/t1': { body: {} },
      'POST /task/t1/tag/backend': { body: {} },
      'POST /task/t1/tag/urgent': { status: 500, body: { err: 'Internal error' } },
    } },
  );
  assert.equal(run.code, 1);
  assert.deepEqual(JSON.parse(run.stderr), {
    error: 'Task t1 was partly updated: add tag "urgent" failed with ClickUp API 500: Internal error',
    hint: 'Applied: fields, add tag "backend". Not applied: add tag "urgent", remove tag "old"',
  });
});

test('task update keeps the plain error when nothing was applied', async () => {
  const run = await runCli(['task', 'update', 't1', '--add-tag', 'backend'], { routes: {
    'GET /task/t1': { body: rawTask() },
    'POST /task/t1/tag/backend': { status: 500, body: { err: 'Internal error' } },
  } });
  assert.equal(run.code, 1);
  assert.equal(JSON.parse(run.stderr).error, 'ClickUp API 500: Internal error');
});
