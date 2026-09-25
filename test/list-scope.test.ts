import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectConfig } from '../src/config.ts';
import { FOLDER_ID, LIST_ID, OTHER_FOLDER_ID, WORKSPACE_ID, rawList, rawTask, runCli } from './helpers.ts';
import type { Route } from './helpers.ts';

// A folder shared by several projects: this one owns lists 800 and 802, another project owns 803.
const SECOND_LIST_ID = '802';
const FOREIGN_LIST_ID = '803';
const scoped: ProjectConfig = {
  provider: 'clickup',
  workspaceId: WORKSPACE_ID,
  folderId: FOLDER_ID,
  listIds: [LIST_ID, SECOND_LIST_ID],
  defaultListId: LIST_ID,
};
const foreignList = { id: FOREIGN_LIST_ID, name: 'Other project' };
const scopeLists: Record<string, Route> = {
  [`GET /list/${LIST_ID}`]: { body: rawList() },
  [`GET /list/${SECOND_LIST_ID}`]: { body: rawList({ id: SECOND_LIST_ID, name: 'Sprint', statuses: [{ status: 'review', type: 'custom' }] }) },
  [`GET /list/${FOREIGN_LIST_ID}`]: { body: rawList({ ...foreignList }) },
};
const foreignTask = { 'GET /task/t9': { body: rawTask({ id: 't9', list: foreignList }) } };

function run(argv: string[], routes: Record<string, Route> = {}) {
  return runCli(argv, { config: scoped, routes });
}

function writes(calls: { method: string }[]): number {
  return calls.filter((c) => c.method !== 'GET').length;
}

test('lists returns only the lists of the project, not the whole folder', async () => {
  const result = await run(['lists'], scopeLists);
  assert.equal(result.code, 0);
  assert.deepEqual((result.json() as { id: string }[]).map((l) => l.id), [LIST_ID, SECOND_LIST_ID]);
  assert.equal(result.calls.some((c) => c.path.startsWith('/folder/')), false);
});

test('lists refuses a project list that is outside the folder', async () => {
  const result = await run(['lists'], {
    ...scopeLists,
    [`GET /list/${SECOND_LIST_ID}`]: { body: rawList({ id: SECOND_LIST_ID, folder: { id: OTHER_FOLDER_ID } }) },
  });
  assert.equal(result.code, 3);
});

test('list create is refused before any call, with a hint about listIds', async () => {
  const result = await run(['list', 'create', '--name', 'Sprint 2']);
  assert.equal(result.code, 2);
  assert.match(JSON.parse(result.stderr).hint, /listIds/);
  assert.equal(result.calls.length, 0);
});

test('tasks without --list filters on the project lists and leaves out tasks homed elsewhere', async () => {
  const result = await run(['tasks'], {
    [`GET /team/${WORKSPACE_ID}/task`]: { body: { tasks: [rawTask(), rawTask({ id: 't9', list: foreignList })], last_page: true } },
  });
  assert.equal(result.code, 0);
  const params = result.calls[0].url.searchParams;
  assert.deepEqual(params.getAll('list_ids[]'), [LIST_ID, SECOND_LIST_ID]);
  assert.equal(params.has('project_ids[]'), false);
  assert.deepEqual((result.json() as { id: string }[]).map((t) => t.id), ['t1']);
});

test('tasks with no result checks the project lists, so a wrong list id is an error', async () => {
  const empty = { [`GET /team/${WORKSPACE_ID}/task`]: { body: { tasks: [], last_page: true } } };
  const ok = await run(['tasks'], { ...empty, ...scopeLists });
  assert.equal(ok.code, 0);
  assert.deepEqual(ok.json(), []);

  const wrong = await run(['tasks'], {
    ...empty,
    ...scopeLists,
    [`GET /list/${SECOND_LIST_ID}`]: { status: 404, body: { err: 'List not found', ECODE: 'SUBCAT_016' } },
  });
  assert.notEqual(wrong.code, 0);
});

test('tasks --status with no result checks the status only in the project lists', async () => {
  const empty = { [`GET /team/${WORKSPACE_ID}/task`]: { body: { tasks: [], last_page: true } } };
  const found = await run(['tasks', '--status', 'review'], { ...empty, ...scopeLists });
  assert.equal(found.code, 0);

  const missing = await run(['tasks', '--status', 'blocked'], {
    ...empty,
    ...scopeLists,
  });
  assert.equal(missing.code, 2);
  assert.equal(JSON.parse(missing.stderr).hint, 'Valid statuses: to do, in progress, complete, review');
});

test('tasks --list with a list of another project exits 3', async () => {
  const result = await run(['tasks', '--list', FOREIGN_LIST_ID], scopeLists);
  assert.equal(result.code, 3);
  assert.equal(result.calls.some((c) => c.path.endsWith('/task')), false);
});

test('task get of a task in another project list exits 3', async () => {
  const result = await run(['task', 'get', 't9'], foreignTask);
  assert.equal(result.code, 3);
});

test('task create in a list of another project exits 3 without writing', async () => {
  const result = await run(['task', 'create', '--name', 'New', '--list', FOREIGN_LIST_ID], scopeLists);
  assert.equal(result.code, 3);
  assert.equal(writes(result.calls), 0);
});

test('task create under a parent of another project exits 3 without writing', async () => {
  const result = await run(['task', 'create', '--name', 'New', '--parent', 't9'], { ...foreignTask, ...scopeLists });
  assert.equal(result.code, 3);
  assert.equal(writes(result.calls), 0);
});

test('task create uses the default list of the project', async () => {
  const result = await run(['task', 'create', '--name', 'New'], {
    ...scopeLists,
    [`POST /list/${LIST_ID}/task`]: { body: rawTask({ name: 'New' }) },
  });
  assert.equal(result.code, 0);
});

test('task update of a task in another project list exits 3 without writing', async () => {
  const result = await run(['task', 'update', 't9', '--name', 'Renamed'], foreignTask);
  assert.equal(result.code, 3);
  assert.equal(writes(result.calls), 0);
});

test('task update --list to a list of another project exits 3 without writing', async () => {
  const result = await run(['task', 'update', 't1', '--list', FOREIGN_LIST_ID], {
    'GET /task/t1': { body: rawTask() },
    ...scopeLists,
  });
  assert.equal(result.code, 3);
  assert.equal(writes(result.calls), 0);
});

test('task update --parent to a task of another project exits 3 without writing', async () => {
  const result = await run(['task', 'update', 't1', '--parent', 't9'], { 'GET /task/t1': { body: rawTask() }, ...foreignTask });
  assert.equal(result.code, 3);
  assert.equal(writes(result.calls), 0);
});

test('task update moves a task between the lists of the project', async () => {
  const result = await run(['task', 'update', 't1', '--list', SECOND_LIST_ID], {
    'GET /task/t1': { body: rawTask() },
    ...scopeLists,
    [`PUT /v3/workspaces/${WORKSPACE_ID}/tasks/t1/home_list/${SECOND_LIST_ID}`]: { body: {} },
  });
  assert.equal(result.code, 0);
});

test('task delete of a task in another project list exits 3 without deleting', async () => {
  const result = await run(['task', 'delete', 't9', '--yes'], foreignTask);
  assert.equal(result.code, 3);
  assert.equal(writes(result.calls), 0);
});

test('comments, checklists and dependencies refuse a task of another project', async () => {
  const task = { 'GET /task/t1': { body: rawTask() } };
  const commands = [
    ['comment', 'add', 't9', '--text', 'Hi'],
    ['comment', 'update', '5', '--task', 't9', '--text', 'Hi'],
    ['checklist', 'add', 't9', '--name', 'Steps'],
    ['checklist', 'check', 'i1', '--task', 't9'],
    ['dependency', 'add', 't9', '--blocked-by', 't1'],
    ['dependency', 'add', 't1', '--blocked-by', 't9'],
  ];
  for (const argv of commands) {
    const result = await run(argv, { ...task, ...foreignTask });
    assert.equal(result.code, 3, argv.join(' '));
    assert.equal(writes(result.calls), 0, argv.join(' '));
  }
});

const initRoutes: Record<string, Route> = {
  [`GET /folder/${FOLDER_ID}`]: { body: { id: FOLDER_ID, name: 'Acme', space: { id: '2' } } },
  'GET /team': { body: { teams: [{ id: WORKSPACE_ID, name: 'Acme' }] } },
  ...scopeLists,
};

function initIn(cwd: string, argv: string[], routes: Record<string, Route> = initRoutes) {
  return runCli(['init', '--folder', FOLDER_ID, ...argv], { cwd, routes });
}

function readConfigFile(cwd: string): unknown {
  return JSON.parse(readFileSync(join(cwd, '.taskwire.json'), 'utf8'));
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'taskwire-scope-'));
}

test('init --scope-list writes listIds, and one scope list is also the default list', async () => {
  const cwd = tempDir();
  const result = await initIn(cwd, ['--scope-list', LIST_ID]);
  assert.equal(result.code, 0);
  assert.deepEqual(readConfigFile(cwd), {
    provider: 'clickup',
    workspaceId: WORKSPACE_ID,
    folderId: FOLDER_ID,
    listIds: [LIST_ID],
    defaultListId: LIST_ID,
  });
  assert.deepEqual((result.json() as { listIds: string[] }).listIds, [LIST_ID]);
});

test('init with several scope lists sets a default list only with --list', async () => {
  const noDefault = tempDir();
  assert.equal((await initIn(noDefault, ['--scope-list', LIST_ID, '--scope-list', SECOND_LIST_ID])).code, 0);
  const written = readConfigFile(noDefault) as ProjectConfig;
  assert.deepEqual(written.listIds, [LIST_ID, SECOND_LIST_ID]);
  assert.equal(written.defaultListId, undefined);

  const withDefault = tempDir();
  assert.equal((await initIn(withDefault, ['--scope-list', LIST_ID, '--scope-list', SECOND_LIST_ID, '--list', SECOND_LIST_ID])).code, 0);
  assert.equal((readConfigFile(withDefault) as ProjectConfig).defaultListId, SECOND_LIST_ID);
});

test('init refuses a --list outside the scope lists and repeated scope lists before any call', async () => {
  for (const argv of [['--scope-list', LIST_ID, '--list', SECOND_LIST_ID], ['--scope-list', LIST_ID, '--scope-list', LIST_ID], ['--scope-list', 'x']]) {
    const result = await initIn(tempDir(), argv);
    assert.equal(result.code, 2, argv.join(' '));
    assert.equal(result.calls.length, 0, argv.join(' '));
  }
});

test('init refuses a scope list outside the folder', async () => {
  const result = await initIn(tempDir(), ['--scope-list', LIST_ID], {
    ...initRoutes,
    [`GET /list/${LIST_ID}`]: { body: rawList({ folder: { id: OTHER_FOLDER_ID } }) },
  });
  assert.equal(result.code, 3);
});

test('init --force keeps listIds for the same folder, checking them again', async () => {
  const cwd = tempDir();
  writeFileSync(join(cwd, '.taskwire.json'), JSON.stringify(scoped));
  const result = await initIn(cwd, ['--force', '--list', SECOND_LIST_ID]);
  assert.equal(result.code, 0);
  assert.deepEqual(readConfigFile(cwd), { ...scoped, defaultListId: SECOND_LIST_ID });
  assert.equal(result.calls.some((c) => c.path === `/list/${LIST_ID}`), true);
});

test('init --force drops listIds when the folder changes or new scope lists are given', async () => {
  const otherFolder = tempDir();
  writeFileSync(join(otherFolder, '.taskwire.json'), JSON.stringify({ ...scoped, folderId: OTHER_FOLDER_ID }));
  assert.equal((await initIn(otherFolder, ['--force'])).code, 0);
  assert.equal((readConfigFile(otherFolder) as ProjectConfig).listIds, undefined);

  const replaced = tempDir();
  writeFileSync(join(replaced, '.taskwire.json'), JSON.stringify(scoped));
  assert.equal((await initIn(replaced, ['--force', '--scope-list', SECOND_LIST_ID])).code, 0);
  assert.deepEqual((readConfigFile(replaced) as ProjectConfig).listIds, [SECOND_LIST_ID]);
});
