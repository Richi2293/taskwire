import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fakeTaskwire, projectDir, runOrchestrator, task, tempDir } from './helpers.ts';

const conventions = { conventions: { language: 'English', instructions: null } };

test('list with no config shows no projects', async () => {
  const run = await runOrchestrator(['list']);
  assert.equal(run.code, 0);
  assert.deepEqual(run.json(), []);
});

test('add saves the absolute path of a taskwire project, after checking taskwire works there', async () => {
  const home = tempDir('home');
  const project = projectDir();
  const cwd = join(project, '..');
  const taskwire = fakeTaskwire(conventions);
  const run = await runOrchestrator(['add', relative(cwd, project), '--test-command', 'npm test'], { home, cwd, taskwire: taskwire.run });
  assert.equal(run.code, 0);
  assert.deepEqual(taskwire.calls, [{ args: ['conventions'], cwd: project }]);
  const saved = JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')) as unknown;
  assert.deepEqual(saved, { projects: [{ path: project, testCommand: 'npm test' }] });

  const list = await runOrchestrator(['list'], { home });
  assert.deepEqual(list.json(), [{ path: project, testCommand: 'npm test' }]);
});

test('add refuses a folder without .taskwire.json', async () => {
  const run = await runOrchestrator(['add', tempDir('plain')]);
  assert.equal(run.code, 2);
  assert.match(JSON.parse(run.stderr).hint, /taskwire setup/);
});

test('add refuses a project already in the list', async () => {
  const home = tempDir('home');
  const project = projectDir();
  const taskwire = fakeTaskwire(conventions).run;
  assert.equal((await runOrchestrator(['add', project], { home, taskwire })).code, 0);
  const again = await runOrchestrator(['add', project], { home, taskwire });
  assert.equal(again.code, 2);
  assert.match(JSON.parse(again.stderr).error, /already/);
});

test('add reports a taskwire failure in the project as a configuration problem', async () => {
  const failing = async () => {
    throw new Error('No ClickUp token found');
  };
  const run = await runOrchestrator(['add', projectDir()], { taskwire: failing });
  assert.equal(run.code, 3);
  assert.match(JSON.parse(run.stderr).error, /No ClickUp token found/);
});

test('remove stops following a project and keeps the others', async () => {
  const home = tempDir('home');
  const website = projectDir('website');
  const shop = projectDir('shop');
  writeFileSync(join(home, 'config.json'), JSON.stringify({ projects: [{ path: website }, { path: shop }] }));
  const run = await runOrchestrator(['remove', website], { home });
  assert.equal(run.code, 0);
  assert.deepEqual(run.json(), { removed: website });
  assert.deepEqual((await runOrchestrator(['list'], { home })).json(), [{ path: shop }]);
});

test('remove refuses a project that is not followed', async () => {
  const run = await runOrchestrator(['remove', '/code/website']);
  assert.equal(run.code, 2);
  assert.match(JSON.parse(run.stderr).error, /not followed/);
});

test('a broken config file is a configuration error', async () => {
  const home = tempDir('home');
  writeFileSync(join(home, 'config.json'), '{"projects": "nope"}');
  const run = await runOrchestrator(['list'], { home });
  assert.equal(run.code, 3);
});

test('next shows the task each project would work on, without writing anything', async () => {
  const home = tempDir('home');
  const website = projectDir('website');
  const shop = projectDir('shop');
  writeFileSync(join(home, 'config.json'), JSON.stringify({ projects: [{ path: website }, { path: shop, blockTag: 'manual' }] }));
  const taskwire = fakeTaskwire({
    // Newest first: "b" is the oldest, but the shop project blocks it with its own tag.
    tasks: [task({ id: 'a', status: 'to do' }), task({ id: 'b', tags: ['manual'] })],
  });
  const run = await runOrchestrator(['next'], { home, taskwire: taskwire.run });
  assert.equal(run.code, 0);
  const read = (cwd: string) => [{ args: ['tasks', '--all-areas'], cwd }, { args: ['project'], cwd }];
  assert.deepEqual(taskwire.calls, [...read(website), ...read(shop)]);
  const rows = run.json() as { project: string; task: { id: string } | null }[];
  assert.deepEqual(rows.map((row) => [row.project, row.task?.id ?? null]), [[website, 'b'], [shop, 'a']]);
});

test('next leaves out the task of a project with agents off, without reading it', async () => {
  const home = tempDir('home');
  const website = projectDir('website');
  const shop = projectDir('shop');
  writeFileSync(join(home, 'config.json'), JSON.stringify({ projects: [{ path: website }, { path: shop, agents: false }] }));
  const taskwire = fakeTaskwire({ tasks: [task({ id: 'a' })] });
  const run = await runOrchestrator(['next'], { home, taskwire: taskwire.run });
  assert.deepEqual(taskwire.calls, [{ args: ['tasks', '--all-areas'], cwd: website }, { args: ['project'], cwd: website }]);
  assert.deepEqual(run.json(), [{ project: website, agents: true, task: task({ id: 'a' }) }, { project: shop, agents: false, task: null }]);
});

test('an unknown command exits 2', async () => {
  const run = await runOrchestrator(['fly']);
  assert.equal(run.code, 2);
});
