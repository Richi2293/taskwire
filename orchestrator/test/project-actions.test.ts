import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createProjectActions } from '../src/dashboard/project-actions.ts';
import { OrchestratorError } from '../src/errors.ts';
import { fakeTaskwire, projectDir, tempDir } from './helpers.ts';

function setup() {
  const home = tempDir('home');
  let changes = 0;
  const act = createProjectActions({
    home,
    runTaskwire: fakeTaskwire({ conventions: { conventions: { language: 'English', instructions: null } } }).run,
    onChange: () => { changes += 1; },
  });
  const projects = () => (JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')) as { projects: unknown[] }).projects;
  return { home, act, projects, changes: () => changes };
}

const refusedWith = (pattern: RegExp) => (error: unknown) => error instanceof OrchestratorError && error.exitCode === 2 && pattern.test(error.message);

test('follow adds the project with its test command, and unfollow removes it', async () => {
  const { act, projects, changes } = setup();
  const shop = projectDir('shop');
  await act({ action: 'follow', project: shop, testCommand: 'npm test' });
  assert.deepEqual(projects(), [{ path: shop, testCommand: 'npm test' }]);
  await act({ action: 'unfollow', project: shop });
  assert.deepEqual(projects(), []);
  assert.equal(changes(), 2);
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
