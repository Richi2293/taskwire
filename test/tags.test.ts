import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProjectConfig } from '../src/config.ts';
import { FOLDER_ID, LIST_ID, WORKSPACE_ID, rawTask, runCli } from './helpers.ts';
import type { FakeCall } from './helpers.ts';

const tag = (name: string) => ({ name });

test('tags counts the tasks of each tag, most used first, then by name', async () => {
  const tasks = [
    rawTask({ id: 't1', tags: [tag('feature'), tag('backend')] }),
    rawTask({ id: 't2', tags: [tag('feature')] }),
    rawTask({ id: 't3', tags: [tag('bug')] }),
    rawTask({ id: 't4', tags: [] }),
  ];
  const run = await runCli(['tags'], { routes: {
    'GET /team/1/task': { body: { tasks, last_page: true } },
  } });
  assert.equal(run.code, 0);
  assert.deepEqual(run.json(), [
    { name: 'feature', tasks: 2 },
    { name: 'backend', tasks: 1 },
    { name: 'bug', tasks: 1 },
  ]);
});

test('tags reads closed tasks and subtasks of the project folder', async () => {
  const run = await runCli(['tags'], { routes: {
    'GET /team/1/task': { body: { tasks: [], last_page: true } },
  } });
  assert.equal(run.code, 0);
  assert.deepEqual(run.json(), []);
  const params = run.calls[0].url.searchParams;
  assert.deepEqual(params.getAll('project_ids[]'), [FOLDER_ID]);
  assert.equal(params.get('include_closed'), 'true');
  assert.equal(params.get('subtasks'), 'true');
});

test('tags leaves out the tasks of lists outside the project lists', async () => {
  const config: ProjectConfig = { provider: 'clickup', workspaceId: WORKSPACE_ID, folderId: FOLDER_ID, listIds: [LIST_ID] };
  const tasks = [
    rawTask({ id: 't1', tags: [tag('feature')] }),
    rawTask({ id: 't9', tags: [tag('other-project')], list: { id: '803', name: 'Other project' } }),
  ];
  const run = await runCli(['tags'], { config, routes: {
    'GET /team/1/task': { body: { tasks, last_page: true } },
  } });
  assert.equal(run.code, 0);
  assert.deepEqual(run.json(), [{ name: 'feature', tasks: 1 }]);
  assert.deepEqual(run.calls[0].url.searchParams.getAll('list_ids[]'), [LIST_ID]);
});

test('tags follows pagination and counts every page', async () => {
  const page = (call: FakeCall) => {
    const n = Number(call.url.searchParams.get('page'));
    const size = n === 0 ? 100 : 1;
    const tasks = Array.from({ length: size }, (_, i) => rawTask({ id: `p${n}-${i}`, tags: [tag('feature')] }));
    return { body: { tasks, last_page: n === 1 } };
  };
  const run = await runCli(['tags'], { routes: { 'GET /team/1/task': page } });
  assert.equal(run.code, 0);
  assert.deepEqual(run.json(), [{ name: 'feature', tasks: 101 }]);
});

test('tags rejects options it does not know', async () => {
  const run = await runCli(['tags', '--status', 'to do']);
  assert.equal(run.code, 2);
  assert.equal(run.calls.length, 0);
});

test('the agent rules point to taskwire tags to find the tags to reuse', () => {
  const rules = readFileSync(new URL('../rules/tasks.md', import.meta.url), 'utf8');
  assert.match(rules, /`taskwire tags`/);
});

test('tags warns that some tags may be missing when it stops before the last page', async () => {
  const full = (call: FakeCall) => {
    const n = Number(call.url.searchParams.get('page'));
    return { body: { tasks: Array.from({ length: 100 }, (_, i) => rawTask({ id: `p${n}-${i}` })), last_page: false } };
  };
  const run = await runCli(['tags'], { routes: { 'GET /team/1/task': full } });
  assert.equal(run.code, 0);
  assert.match(run.stderr, /Some tags may be missing/);
  assert.doesNotMatch(run.stderr, /--status/);
});
