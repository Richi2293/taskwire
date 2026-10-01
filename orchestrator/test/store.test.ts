import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createStore } from '../src/dashboard/snapshot.ts';
import type { RunTaskwire } from '../src/taskwire.ts';
import { fakeTaskwire, projectDir, task, tempDir } from './helpers.ts';

const NOW = Date.UTC(2026, 8, 28, 10, 0, 0);

function home(projects: string[]): string {
  const dir = tempDir('home');
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ projects: projects.map((path) => ({ path })) }));
  return dir;
}

const detail = (text: string) => ({ ...task(), comments: [{ id: 'c1', author: 'jane', date: '2026-09-28T09:00:00.000Z', text }] });

// One project with a task to review and a task an agent could take.
function setup(tasks: unknown[] = [task({ id: 'r1', needs: 'review', status: 'qa', updatedAt: '2026-09-28T09:00:00.000Z' }), task({ id: 'b1' })]) {
  const website = projectDir('website');
  let list = tasks;
  const taskwire = fakeTaskwire({ tasks: () => list, 'task get': detail('> **Next:** review the branch.') });
  let now = NOW;
  const dir = home([website]);
  const store = createStore({ home: dir, runTaskwire: taskwire.run, now: () => now });
  return {
    website,
    dir,
    store,
    taskwire,
    calls: () => taskwire.calls.map((call) => call.args.join(' ')),
    setTasks: (next: unknown[]) => { list = next; },
    advance: (ms: number) => { now += ms; },
  };
}

test('the state is ready at once, without calling the task system', () => {
  const { store, taskwire } = setup();
  const state = store.state();
  assert.deepEqual(taskwire.calls, []);
  assert.deepEqual(state.projects.map((p) => [p.projectName, p.readAt, p.reading]), [['website', null, false]]);
  assert.deepEqual(state.sync, { readAt: null, reading: false });
});

test('a read takes one task list per project, and the detail of each task waiting', async () => {
  const { store, calls } = setup();
  await store.refresh();
  assert.deepEqual(calls(), ['tasks', 'task get r1 --comments 1']);
  const state = store.state();
  assert.deepEqual(state.waiting.map((item) => [item.id, item.note]), [['r1', ['Next: review the branch.']]]);
  assert.equal(state.control.firstTask?.id, 'b1');
  assert.equal(state.projects[0].readAt, new Date(NOW).toISOString());
  assert.deepEqual(state.sync, { readAt: new Date(NOW).toISOString(), reading: false });
});

test('the detail of a waiting task is read again only when the task changed', async () => {
  const { store, calls, setTasks, advance } = setup();
  await store.refresh();
  advance(61_000);
  await store.refresh();
  assert.deepEqual(calls(), ['tasks', 'task get r1 --comments 1', 'tasks']);
  setTasks([task({ id: 'r1', needs: 'review', status: 'qa', updatedAt: '2026-09-28T09:30:00.000Z' })]);
  await store.refresh();
  assert.deepEqual(calls().slice(3), ['tasks', 'task get r1 --comments 1']);
});

test('a task without updatedAt, from an older taskwire, has its detail read every time', async () => {
  const { store, calls } = setup([task({ id: 'r1', needs: 'review' })]);
  await store.refresh();
  await store.refresh();
  assert.deepEqual(calls(), ['tasks', 'task get r1 --comments 1', 'tasks', 'task get r1 --comments 1']);
});

test('looking at the page starts a read in the background only when the data is older than a minute', async () => {
  const { store, calls, advance } = setup();
  store.look();
  assert.equal(store.state().sync.reading, true);
  store.look();
  await store.idle();
  assert.deepEqual(calls(), ['tasks', 'task get r1 --comments 1'], 'one read, even when looked at twice');
  assert.equal(store.state().sync.reading, false);
  advance(30_000);
  store.look();
  await store.idle();
  assert.equal(calls().length, 2, 'fresh data is not read again');
  advance(31_000);
  store.look();
  await store.idle();
  assert.equal(calls().length, 3);
});

test('refresh of one project reads only that project', async () => {
  const website = projectDir('website');
  const shop = projectDir('shop');
  const taskwire = fakeTaskwire({ tasks: [] });
  const store = createStore({ home: home([website, shop]), runTaskwire: taskwire.run, now: () => NOW });
  await store.refresh(shop);
  assert.deepEqual(taskwire.calls.map((call) => call.cwd), [shop]);
  assert.deepEqual(store.state().projects.map((p) => [p.projectName, p.readAt !== null]), [['website', false], ['shop', true]]);
});

test('a failed read keeps the last data, with the reason', async () => {
  const website = projectDir('website');
  let failing = false;
  const run: RunTaskwire = async (args) => {
    if (failing) throw new Error('taskwire tasks: Network error calling ClickUp');
    return args[0] === 'tasks' ? [task({ id: 'r1', needs: 'review', updatedAt: '2026-09-28T09:00:00.000Z' })] : detail('> **Next:** review.');
  };
  let now = NOW;
  const store = createStore({ home: home([website]), runTaskwire: run, now: () => now });
  await store.refresh();
  failing = true;
  now += 61_000;
  await store.refresh();
  const state = store.state();
  assert.equal(state.projects[0].error, 'taskwire tasks: Network error calling ClickUp');
  assert.equal(state.projects[0].readAt, new Date(NOW).toISOString());
  assert.deepEqual(state.waiting.map((item) => item.id), ['r1']);
});

test('what was read is kept on disk, so the page has data at once after a restart', async () => {
  const { store, dir, website } = setup();
  await store.refresh();
  const restarted = createStore({ home: dir, runTaskwire: fakeTaskwire({}).run, now: () => NOW + 5 * 60_000 });
  const state = restarted.state();
  assert.deepEqual(state.waiting.map((item) => item.id), ['r1']);
  assert.equal(state.projects[0].readAt, new Date(NOW).toISOString());
  assert.equal(state.projects[0].project, website);
});

test('after an action, the task leaves the queue at once and its project is read again', async () => {
  const { store, calls, setTasks } = setup();
  await store.refresh();
  setTasks([task({ id: 'r1', status: 'qa', updatedAt: '2026-09-28T09:40:00.000Z' })]);
  store.changed(store.state().projects[0].project, 'r1');
  assert.deepEqual(store.state().waiting, []);
  await store.idle();
  assert.deepEqual(calls().slice(2), ['tasks']);
});

test('a project no longer followed leaves the state', async () => {
  const { store, dir } = setup();
  await store.refresh();
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ projects: [] }));
  assert.deepEqual(store.state().projects, []);
  assert.deepEqual(store.state().waiting, []);
});

test('each project shows who merges it and where its release stands, and the live tasks still open are listed', async () => {
  const website = projectDir('website');
  const dir = tempDir('home');
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ projects: [{ path: website, merge: 'main', stagingBranch: 'develop' }] }));
  writeFileSync(join(dir, 'releases.json'), JSON.stringify({ [website]: { state: 'waiting-test', reason: '1 task waits for a test by hand', pr: null, head: null, headSeenAt: null, at: '2026-09-28T09:00:00.000Z' } }));
  const entry = (id: string) => ({ project: website, task: id, name: `Task ${id}`, url: `https://app.clickup.com/t/${id}`, pr: 12, at: '2026-09-28T09:30:00.000Z' });
  writeFileSync(join(dir, 'live.json'), JSON.stringify({ live: [entry('l1'), entry('gone')], closed: [], merged: {}, asked: {} }));
  const store = createStore({ home: dir, runTaskwire: fakeTaskwire({ tasks: [task({ id: 'l1', status: 'qa' })] }).run, now: () => NOW });
  await store.refresh();
  const state = store.state();
  assert.equal(state.projects[0].merge, 'main');
  assert.equal(state.projects[0].stagingBranch, 'develop');
  assert.equal(state.projects[0].productionBranch, null);
  assert.deepEqual(state.projects[0].release, { state: 'waiting-test', reason: '1 task waits for a test by hand', pr: null });
  // "gone" was closed in the task system: it is not among the open tasks any more.
  assert.deepEqual(state.live.map((item) => [item.id, item.name, item.projectName, item.pr]), [['l1', 'Task l1', 'website', 12]]);
});
