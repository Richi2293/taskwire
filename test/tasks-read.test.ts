import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FOLDER_ID, LIST_ID, OTHER_FOLDER_ID, rawList, rawTask, runCli } from './helpers.ts';
import type { FakeCall } from './helpers.ts';

test('tasks without --list searches the whole folder through the team endpoint', async () => {
  const run = await runCli(['tasks'], { routes: {
    'GET /team': { body: { teams: [{ id: '1', name: 'Acme' }] } },
    'GET /team/1/task': { body: { tasks: [rawTask()], last_page: true } },
  } });
  assert.equal(run.code, 0);
  const call = run.calls.find((c) => c.path === '/team/1/task');
  assert.deepEqual(call?.url.searchParams.getAll('project_ids[]'), [FOLDER_ID]);
  assert.equal(call?.url.searchParams.get('subtasks'), 'true');
  assert.equal(call?.url.searchParams.get('include_closed'), 'false');
  assert.deepEqual((run.json() as { id: string }[]).map((t) => t.id), ['t1']);
});

test('tasks with --list and filters reads the list endpoint', async () => {
  const run = await runCli(
    ['tasks', '--list', LIST_ID, '--status', 'to do', '--tag', 'backend', '--assignee', '7', '--include-closed'],
    { routes: {
      [`GET /list/${LIST_ID}`]: { body: rawList() },
      [`GET /list/${LIST_ID}/task`]: { body: { tasks: [], last_page: true } },
    } },
  );
  assert.equal(run.code, 0);
  const params = run.calls[1].url.searchParams;
  assert.deepEqual(params.getAll('statuses[]'), ['to do']);
  assert.deepEqual(params.getAll('tags[]'), ['backend']);
  assert.deepEqual(params.getAll('assignees[]'), ['7']);
  assert.equal(params.get('include_closed'), 'true');
});

test('tasks with --list from another folder exits 3', async () => {
  const run = await runCli(['tasks', '--list', LIST_ID], { routes: {
    [`GET /list/${LIST_ID}`]: { body: rawList({ folder: { id: OTHER_FOLDER_ID } }) },
  } });
  assert.equal(run.code, 3);
});

test('tasks follows pagination past 100 tasks', async () => {
  const page = (call: FakeCall) => {
    const n = Number(call.url.searchParams.get('page'));
    const tasks = Array.from({ length: n < 2 ? 100 : 5 }, (_, i) => rawTask({ id: `p${n}-${i}` }));
    return { body: { tasks, last_page: n >= 2 } };
  };
  const run = await runCli(['tasks'], { routes: {
    'GET /team': { body: { teams: [{ id: '1', name: 'Acme' }] } },
    'GET /team/1/task': page,
  } });
  assert.equal(run.code, 0);
  assert.equal((run.json() as unknown[]).length, 205);
});

test('tasks --assignee me resolves the current user', async () => {
  const run = await runCli(['tasks', '--assignee', 'me'], { routes: {
    'GET /user': { body: { user: { id: 42, username: 'r' } } },
    'GET /team': { body: { teams: [{ id: '1', name: 'Acme' }] } },
    'GET /team/1/task': { body: { tasks: [], last_page: true } },
  } });
  const call = run.calls.find((c) => c.path === '/team/1/task');
  assert.deepEqual(call?.url.searchParams.getAll('assignees[]'), ['42']);
});

test('task get returns the detail with comments', async () => {
  const run = await runCli(['task', 'get', '#t1'], { routes: {
    'GET /task/t1': { body: rawTask({ markdown_description: 'Body' }) },
    'GET /task/t1/comment': { body: { comments: [{ id: '5', comment_text: 'Hi', user: { id: 7, username: 'r' }, date: '0' }] } },
  } });
  assert.equal(run.code, 0);
  const detail = run.json() as { description: string; comments: { text: string }[] };
  assert.equal(detail.description, 'Body');
  assert.equal(detail.comments[0].text, 'Hi');
});

test('task get of a task in another folder exits 3 without reading comments', async () => {
  const run = await runCli(['task', 'get', 't1'], { routes: {
    'GET /task/t1': { body: rawTask({ folder: { id: OTHER_FOLDER_ID, name: 'Other' } }) },
  } });
  assert.equal(run.code, 3);
  assert.equal(run.calls.length, 1);
});

test('tasks uses the workspaceId from .taskwire.json without listing workspaces', async () => {
  const run = await runCli(['tasks'], { routes: {
    'GET /team/1/task': { body: { tasks: [], last_page: true } },
  } });
  assert.equal(run.code, 0);
  assert.deepEqual(run.calls.map((c) => c.path), ['/team/1/task']);
});

test('tasks without workspaceId finds the workspace of the folder among several', async () => {
  const run = await runCli(['tasks'], {
    config: { provider: 'clickup', folderId: FOLDER_ID },
    routes: {
      [`GET /folder/${FOLDER_ID}`]: { body: { id: FOLDER_ID, name: 'Website', space: { id: '2' } } },
      'GET /team': { body: { teams: [{ id: '1', name: 'Acme' }, { id: '3', name: 'Other' }] } },
      'GET /team/1/space': { body: { spaces: [{ id: '8', name: 'Elsewhere' }] } },
      'GET /team/3/space': { body: { spaces: [{ id: '2', name: 'Projects' }] } },
      'GET /team/3/task': { body: { tasks: [rawTask()], last_page: true } },
    },
  });
  assert.equal(run.code, 0);
  assert.deepEqual((run.json() as { id: string }[]).map((t) => t.id), ['t1']);
});

test('tasks exits 3 when no workspace contains the folder space', async () => {
  const run = await runCli(['tasks'], {
    config: { provider: 'clickup', folderId: FOLDER_ID },
    routes: {
      [`GET /folder/${FOLDER_ID}`]: { body: { id: FOLDER_ID, name: 'Website', space: { id: '2' } } },
      'GET /team': { body: { teams: [{ id: '1', name: 'Acme' }, { id: '3', name: 'Other' }] } },
      'GET /team/1/space': { body: { spaces: [] } },
      'GET /team/3/space': { body: { spaces: [] } },
    },
  });
  assert.equal(run.code, 3);
});

test('tasks stops at the page limit and warns on stderr', async () => {
  const full = (call: FakeCall) => {
    const n = Number(call.url.searchParams.get('page'));
    return { body: { tasks: Array.from({ length: 100 }, (_, i) => rawTask({ id: `p${n}-${i}` })), last_page: false } };
  };
  const run = await runCli(['tasks'], { routes: { 'GET /team/1/task': full } });
  assert.equal(run.code, 0);
  assert.equal((run.json() as unknown[]).length, 5000);
  assert.deepEqual(JSON.parse(run.stderr), {
    warning: 'Stopped after 5000 tasks, there may be more',
    hint: 'Narrow the query with --list, --status or --tag',
  });
});

const NO_TASKS = { body: { tasks: [], last_page: true } };

test('tasks --list with an unknown status and no result is a usage error with the valid statuses', async () => {
  const run = await runCli(['tasks', '--list', LIST_ID, '--status', 'in progres'], { routes: {
    [`GET /list/${LIST_ID}`]: { body: rawList() },
    [`GET /list/${LIST_ID}/task`]: NO_TASKS,
  } });
  assert.equal(run.code, 2);
  assert.deepEqual(JSON.parse(run.stderr), {
    error: 'Status "in progres" does not exist in this project\'s lists',
    hint: 'Valid statuses: to do, in progress, complete',
  });
});

test('tasks with an unknown status checks every list of the folder', async () => {
  const run = await runCli(['tasks', '--status', 'doing'], { routes: {
    'GET /team/1/task': NO_TASKS,
    [`GET /folder/${FOLDER_ID}/list`]: { body: { lists: [{ id: LIST_ID }, { id: '801' }] } },
    [`GET /list/${LIST_ID}`]: { body: rawList() },
    'GET /list/801': { body: rawList({ id: '801', statuses: [{ status: 'to do' }, { status: 'review' }] }) },
  } });
  assert.equal(run.code, 2);
  assert.equal(JSON.parse(run.stderr).hint, 'Valid statuses: to do, in progress, complete, review');
});

test('tasks with a valid status and no result returns an empty list', async () => {
  const run = await runCli(['tasks', '--status', 'Review'], { routes: {
    'GET /team/1/task': NO_TASKS,
    [`GET /folder/${FOLDER_ID}/list`]: { body: { lists: [{ id: LIST_ID }, { id: '801' }] } },
    [`GET /list/${LIST_ID}`]: { body: rawList() },
    'GET /list/801': { body: rawList({ id: '801', statuses: [{ status: 'review' }] }) },
  } });
  assert.equal(run.code, 0);
  assert.deepEqual(run.json(), []);
});

test('tasks with a status and some result does not load the lists', async () => {
  const run = await runCli(['tasks', '--status', 'to do'], { routes: {
    'GET /team/1/task': { body: { tasks: [rawTask()], last_page: true } },
  } });
  assert.equal(run.code, 0);
  assert.equal(run.calls.length, 1);
});
