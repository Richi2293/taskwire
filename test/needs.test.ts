import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FOLDER_ID, LIST_ID, WORKSPACE_ID, rawList, rawTask, runCli } from './helpers.ts';
import type { CliRun } from './helpers.ts';

const tags = (...names: string[]) => names.map((name) => ({ name }));
const listRoute = { [`GET /list/${LIST_ID}`]: { body: rawList() } };

function writes(run: CliRun): string[] {
  return run.calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`);
}

test('task update --needs adds the tag of that kind and removes the other needs tags only', async () => {
  const run = await runCli(['task', 'update', 't1', '--needs', 'test'], { routes: {
    'GET /task/t1': { body: rawTask({ tags: tags('needs-decision', 'backend') }) },
    'POST /task/t1/tag/needs-test': { body: {} },
    'DELETE /task/t1/tag/needs-decision': { body: {} },
  } });
  assert.equal(run.code, 0);
  assert.deepEqual(writes(run), ['POST /task/t1/tag/needs-test', 'DELETE /task/t1/tag/needs-decision']);
});

test('task update --needs none removes every needs tag of the task', async () => {
  const run = await runCli(['task', 'update', 't1', '--needs', 'none'], { routes: {
    'GET /task/t1': { body: rawTask({ tags: tags('needs-review', 'backend') }) },
    'DELETE /task/t1/tag/needs-review': { body: {} },
  } });
  assert.equal(run.code, 0);
  assert.deepEqual(writes(run), ['DELETE /task/t1/tag/needs-review']);
});

test('task update --needs keeps a needs tag the task already has without writing it again', async () => {
  const run = await runCli(['task', 'update', 't1', '--needs', 'review'], { routes: {
    'GET /task/t1': { body: rawTask({ tags: tags('needs-review') }) },
  } });
  assert.equal(run.code, 0);
  assert.deepEqual(writes(run), []);
  assert.equal((run.json() as { needs: string }).needs, 'review');
});

test('task update --needs with an unknown kind exits 2 without calling ClickUp', async () => {
  const run = await runCli(['task', 'update', 't1', '--needs', 'approval']);
  assert.equal(run.code, 2);
  assert.match(JSON.parse(run.stderr).hint, /decision, test, review or none/);
  assert.equal(run.calls.length, 0);
});

test('task create --needs sends the needs tag with the other tags', async () => {
  const run = await runCli(['task', 'create', '--name', 'N', '--tag', 'backend', '--needs', 'decision'], { routes: {
    ...listRoute, [`POST /list/${LIST_ID}/task`]: { body: rawTask({ tags: tags('backend', 'needs-decision') }) },
  } });
  assert.equal(run.code, 0);
  assert.deepEqual((run.calls.at(-1)?.body as { tags: string[] }).tags, ['backend', 'needs-decision']);
  assert.equal((run.json() as { needs: string }).needs, 'decision');
});

test('task create rejects --needs none', async () => {
  const run = await runCli(['task', 'create', '--name', 'N', '--needs', 'none']);
  assert.equal(run.code, 2);
  assert.match(JSON.parse(run.stderr).hint, /decision, test or review/);
  assert.equal(run.calls.length, 0);
});

const mixedTasks = [
  rawTask({ id: 'decide', tags: tags('needs-decision') }),
  rawTask({ id: 'plain', tags: tags('backend') }),
  rawTask({ id: 'try', tags: tags('backend', 'needs-test') }),
];
const listTasksRoute = { [`GET /list/${LIST_ID}/task`]: { body: { tasks: mixedTasks, last_page: true } } };

test('tasks --needs keeps the tasks waiting for a person for that reason', async () => {
  const run = await runCli(['tasks', '--list', LIST_ID, '--needs', 'test'], { routes: { ...listRoute, ...listTasksRoute } });
  assert.equal(run.code, 0);
  assert.deepEqual((run.json() as { id: string }[]).map((t) => t.id), ['try']);
});

test('tasks --needs any keeps every task waiting for a person', async () => {
  const run = await runCli(['tasks', '--list', LIST_ID, '--needs', 'any'], { routes: { ...listRoute, ...listTasksRoute } });
  assert.equal(run.code, 0);
  assert.deepEqual((run.json() as { id: string }[]).map((t) => t.id), ['decide', 'try']);
});

test('tasks --needs with an unknown kind exits 2 without calling ClickUp', async () => {
  const run = await runCli(['tasks', '--needs', 'none']);
  assert.equal(run.code, 2);
  assert.match(JSON.parse(run.stderr).hint, /decision, test, review or any/);
  assert.equal(run.calls.length, 0);
});

test('tasks shows the needs of each task, null when it waits for nobody', async () => {
  const run = await runCli(['tasks', '--list', LIST_ID], { routes: { ...listRoute, ...listTasksRoute } });
  assert.equal(run.code, 0);
  assert.deepEqual((run.json() as { needs: string | null }[]).map((t) => t.needs), ['decision', null, 'test']);
});

test('task get shows the needs of the task and of its subtasks', async () => {
  const run = await runCli(['task', 'get', 't1', '--comments', '0'], { routes: {
    'GET /task/t1': { body: rawTask({ tags: tags('needs-review'), subtasks: [rawTask({ id: 's1', tags: tags('needs-test') })] }) },
  } });
  assert.equal(run.code, 0);
  const detail = run.json() as { needs: string; subtasks: { needs: string }[] };
  assert.equal(detail.needs, 'review');
  assert.equal(detail.subtasks[0].needs, 'test');
});

const renamed = {
  provider: 'clickup' as const,
  workspaceId: WORKSPACE_ID,
  folderId: FOLDER_ID,
  defaultListId: LIST_ID,
  needsTags: { test: 'Da-Provare' },
};

test('needsTags in the config renames a needs tag, in lowercase like ClickUp', async () => {
  const update = await runCli(['task', 'update', 't1', '--needs', 'test'], { config: renamed, routes: {
    'GET /task/t1': { body: rawTask({ tags: tags('needs-decision') }) },
    'POST /task/t1/tag/da-provare': { body: {} },
    'DELETE /task/t1/tag/needs-decision': { body: {} },
  } });
  assert.equal(update.code, 0);
  assert.deepEqual(writes(update), ['POST /task/t1/tag/da-provare', 'DELETE /task/t1/tag/needs-decision']);

  const list = await runCli(['tasks', '--list', LIST_ID, '--needs', 'test'], { config: renamed, routes: {
    ...listRoute,
    [`GET /list/${LIST_ID}/task`]: { body: { tasks: [rawTask({ id: 'old', tags: tags('needs-test') }), rawTask({ id: 'new', tags: tags('da-provare') })], last_page: true } },
  } });
  assert.deepEqual((list.json() as { id: string }[]).map((t) => t.id), ['new']);
});
