import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createProjectActions } from '../src/dashboard/project-actions.ts';
import { OrchestratorError } from '../src/errors.ts';
import { fakeTaskwire, projectDir, tempDir } from './helpers.ts';

function setup() {
  const home = tempDir('home');
  const changed: string[] = [];
  const act = createProjectActions({
    home,
    runTaskwire: fakeTaskwire({ conventions: { conventions: { language: 'English', instructions: null } } }).run,
    onChange: (project) => { changed.push(project); },
  });
  const projects = () => (JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')) as { projects: unknown[] }).projects;
  return { home, act, projects, changed };
}

const refusedWith = (pattern: RegExp) => (error: unknown) => error instanceof OrchestratorError && error.exitCode === 2 && pattern.test(error.message);

test('follow adds the project with its test command, and unfollow removes it', async () => {
  const { act, projects, changed } = setup();
  const shop = projectDir('shop');
  await act({ action: 'follow', project: shop, testCommand: 'npm test' });
  assert.deepEqual(projects(), [{ path: shop, testCommand: 'npm test' }]);
  await act({ action: 'unfollow', project: shop });
  assert.deepEqual(projects(), []);
  // Only the project just followed needs a read.
  assert.deepEqual(changed, [shop]);
});

test('agents-off and agents-on switch the agents of a followed project', async () => {
  const { act, projects } = setup();
  const shop = projectDir('shop');
  await act({ action: 'follow', project: shop });
  await act({ action: 'agents-off', project: shop });
  assert.deepEqual(projects(), [{ path: shop, agents: false }]);
  await act({ action: 'agents-on', project: shop });
  assert.deepEqual(projects(), [{ path: shop }]);
});

test('an empty test command from the page means no test command', async () => {
  const { act, projects } = setup();
  const shop = projectDir('shop');
  await act({ action: 'follow', project: shop, testCommand: '  ' });
  assert.deepEqual(projects(), [{ path: shop }]);
});

test('a request with an unknown action, no project or a test command that is not text is refused', async () => {
  const { act, home } = setup();
  writeFileSync(join(home, 'config.json'), JSON.stringify({ projects: [] }));
  await assert.rejects(act({ action: 'delete', project: '/code/shop' }), refusedWith(/Unknown/));
  await assert.rejects(act({ action: 'follow' }), refusedWith(/project/));
  await assert.rejects(act({ action: 'follow', project: projectDir(), testCommand: 42 }), refusedWith(/testCommand/));
  await assert.rejects(act('follow'), refusedWith(/JSON object/));
});

test('place sets the area and the group of a followed project, and empty values remove them', async () => {
  const { act, projects } = setup();
  const shop = projectDir('shop');
  await act({ action: 'follow', project: shop });
  await act({ action: 'place', project: shop, area: ' FE ', group: 'Shop' });
  assert.deepEqual(projects(), [{ path: shop, area: 'fe', group: 'Shop' }]);
  await act({ action: 'place', project: shop, area: '', group: '' });
  assert.deepEqual(projects(), [{ path: shop }]);
  await assert.rejects(act({ action: 'place', project: shop, area: 'front end' }), refusedWith(/area/));
  await assert.rejects(act({ action: 'place', project: shop, group: 'x'.repeat(101) }), refusedWith(/group/));
});
