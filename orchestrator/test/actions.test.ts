import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createActions } from '../src/dashboard/actions.ts';
import { OrchestratorError } from '../src/errors.ts';
import { fakeTaskwire, projectDir, task, tempDir } from './helpers.ts';

function setup(projectOptions: Record<string, unknown> = {}) {
  const home = tempDir('home');
  const project = projectDir('shop');
  writeFileSync(join(home, 'config.json'), JSON.stringify({ projects: [{ path: project, ...projectOptions }] }));
  const taskwire = fakeTaskwire({
    'tasks --needs any': [task({ id: 'd1', needs: 'decision' }), task({ id: 't1', needs: 'test', status: 'qa' }), task({ id: 'r1', needs: 'review', status: 'qa' })],
    'task update': {},
    'comment add': { id: 'c1' },
  });
  let changes = 0;
  const act = createActions({ home, runTaskwire: taskwire.run, onChange: () => { changes += 1; } });
  return { project, taskwire, act, changes: () => changes };
}

const writes = (calls: { args: string[] }[]) => calls.filter((call) => call.args[0] !== 'tasks').map((call) => call.args);

test('answer adds the person answer as a comment, then clears the decision mark', async () => {
  const { project, taskwire, act, changes } = setup();
  await act({ project, task: 'd1', action: 'answer', text: 'Convert with a fixed rate, USD and GBP only.' });
  assert.deepEqual(writes(taskwire.calls), [
    ['comment', 'add', 'd1', '--text', 'Answer from the person, via the dashboard:\n\nConvert with a fixed rate, USD and GBP only.'],
    ['task', 'update', 'd1', '--needs', 'none'],
  ]);
  assert.ok(taskwire.calls.every((call) => call.cwd === project));
  assert.equal(changes(), 1);
});

test('approve clears the mark of a task to review or to test', async () => {
  const { project, taskwire, act } = setup();
  await act({ project, task: 'r1', action: 'approve' });
  await act({ project, task: 't1', action: 'approve' });
  assert.deepEqual(writes(taskwire.calls), [['task', 'update', 'r1', '--needs', 'none'], ['task', 'update', 't1', '--needs', 'none']]);
});

test('send back adds the person feedback, clears the mark and moves the task back to a start status', async () => {
  const { project, taskwire, act } = setup();
  await act({ project, task: 't1', action: 'send-back', text: 'The total is not bold on Safari.' });
  assert.deepEqual(writes(taskwire.calls), [
    ['comment', 'add', 't1', '--text', 'Answer from the person, via the dashboard:\n\nThe total is not bold on Safari.'],
    ['task', 'update', 't1', '--needs', 'none', '--status', 'to do'],
  ]);
});

test('send back uses the first start status of the project when it sets them', async () => {
  const { project, taskwire, act } = setup({ startStatuses: ['ready'] });
  await act({ project, task: 'r1', action: 'send-back', text: 'Rename the function.' });
  assert.deepEqual(writes(taskwire.calls).at(-1), ['task', 'update', 'r1', '--needs', 'none', '--status', 'ready']);
});

test('keep agents away adds the block tag of the project', async () => {
  const { project, taskwire, act } = setup({ blockTag: 'manual' });
  await act({ project, task: 'd1', action: 'block' });
  assert.deepEqual(writes(taskwire.calls), [['task', 'update', 'd1', '--add-tag', 'manual']]);
});

test('refuses actions that do not fit, before writing anything', async () => {
  const { project, taskwire, act } = setup();
  const refused = [
    { project, task: 'r1', action: 'answer', text: 'x' },
    { project, task: 'd1', action: 'approve' },
    { project, task: 'd1', action: 'send-back', text: 'x' },
    { project, task: 'd1', action: 'answer', text: '   ' },
    { project, task: 'nope', action: 'approve' },
    { project: '/somewhere/else', task: 'r1', action: 'approve' },
    { project, task: 'r1', action: 'delete' },
  ];
  for (const request of refused) {
    await assert.rejects(act(request), (error: unknown) => error instanceof OrchestratorError && error.exitCode === 2, JSON.stringify(request));
  }
  assert.deepEqual(writes(taskwire.calls), []);
});

test('accept the proposal tells the agent to go ahead with it, then clears the decision mark', async () => {
  const { project, taskwire, act } = setup();
  await act({ project, task: 'd1', action: 'accept-proposal' });
  assert.deepEqual(writes(taskwire.calls), [
    ['comment', 'add', 'd1', '--text', 'Answer from the person, via the dashboard:\n\nGo ahead with your proposal.'],
    ['task', 'update', 'd1', '--needs', 'none'],
  ]);
  await assert.rejects(act({ project, task: 'r1', action: 'accept-proposal' }), (error: unknown) => error instanceof OrchestratorError);
});
