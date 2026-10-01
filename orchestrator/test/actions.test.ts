import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createActions } from '../src/dashboard/actions.ts';
import { readMerges, writeMerges } from '../src/merges.ts';
import { OrchestratorError } from '../src/errors.ts';
import { fakeTaskwire, projectDir, task, tempDir } from './helpers.ts';

function setup(projectOptions: Record<string, unknown> = {}) {
  const home = tempDir('home');
  const project = projectDir('shop');
  writeFileSync(join(home, 'config.json'), JSON.stringify({ projects: [{ path: project, ...projectOptions }] }));
  const taskwire = fakeTaskwire({
    'tasks --needs any': [
      task({ id: 'd1', needs: 'decision' }),
      task({ id: 't1', needs: 'test', status: 'qa' }),
      task({ id: 'r1', needs: 'review', status: 'qa', list: { id: 'l1', name: 'Backlog' } }),
      task({ id: 'p1', needs: 'decision', tags: ['no-agent'], list: { id: 'l1', name: 'Backlog' } }),
    ],
    lists: [{ id: 'l0', name: 'Other', statuses: ['open', 'closed'] }, { id: 'l1', name: 'Backlog', statuses: ['backlog', 'in progress', 'qa', 'complete'] }],
    'task update': {},
    'comment add': { id: 'c1' },
  });
  const changed: [string, string | undefined][] = [];
  const act = createActions({ home, runTaskwire: taskwire.run, onChange: (path, task) => { changed.push([path, task]); } });
  return { home, project, taskwire, act, changes: () => changed.length, changed };
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

test('after an action only its project is read again, and a task whose mark was cleared leaves the queue', async () => {
  const { project, act, changed } = setup();
  await act({ project, task: 'r1', action: 'approve' });
  await act({ project, task: 'd1', action: 'block' });
  // A blocked task still waits for the person: it stays in the queue until the next read.
  assert.deepEqual(changed, [[project, 'r1'], [project, undefined]]);
});

test('accept task lets agents take a task the analysis proposed: it clears the mark and removes the block tag', async () => {
  const { project, taskwire, act, changed } = setup({ blockTag: 'manual' });
  await act({ project, task: 'p1', action: 'accept-task' });
  assert.deepEqual(writes(taskwire.calls), [
    ['comment', 'add', 'p1', '--text', 'Answer from the person, via the dashboard:\n\nAccepted: agents may work on this task.'],
    ['task', 'update', 'p1', '--needs', 'none', '--remove-tag', 'manual'],
  ]);
  assert.deepEqual(changed, [[project, 'p1']]);
});

test('reject task closes a task the analysis proposed, in the closed status of its list', async () => {
  const { project, taskwire, act } = setup();
  await act({ project, task: 'p1', action: 'reject-task' });
  assert.deepEqual(writes(taskwire.calls), [
    ['lists'],
    ['comment', 'add', 'p1', '--text', 'Answer from the person, via the dashboard:\n\nRejected: this task is not needed.'],
    ['task', 'update', 'p1', '--needs', 'none', '--status', 'complete'],
  ]);
});

test('close moves a task ready to close to the closed status, or to the one the project sets', async () => {
  const first = setup();
  await first.act({ project: first.project, task: 'r1', action: 'close' });
  assert.deepEqual(writes(first.taskwire.calls), [
    ['lists'],
    ['comment', 'add', 'r1', '--text', 'Answer from the person, via the dashboard:\n\nClosed: the work is done.'],
    ['task', 'update', 'r1', '--needs', 'none', '--status', 'complete'],
  ]);
  const second = setup({ closedStatus: 'done' });
  await second.act({ project: second.project, task: 'r1', action: 'close' });
  assert.deepEqual(writes(second.taskwire.calls).at(-1), ['task', 'update', 'r1', '--needs', 'none', '--status', 'done']);
  assert.ok(!second.taskwire.calls.some((call) => call.args[0] === 'lists'));
});

test('close fits only a review, accept and reject only a decision, and nothing closes without a known closed status', async () => {
  const { project, taskwire, act } = setup();
  const refused = [
    { project, task: 't1', action: 'close' },
    { project, task: 'd1', action: 'close' },
    { project, task: 'r1', action: 'accept-task' },
    { project, task: 'r1', action: 'reject-task' },
    // d1 has no list in its summary, so its closed status is unknown.
    { project, task: 'd1', action: 'reject-task' },
  ];
  for (const request of refused) {
    await assert.rejects(act(request), (error: unknown) => error instanceof OrchestratorError && error.exitCode === 2, JSON.stringify(request));
  }
  assert.deepEqual(writes(taskwire.calls).filter((args) => args[0] !== 'lists'), []);
});

// A run of the task as runs.jsonl keeps it, with the branch, pull request and commit the pass ended on.
function recordRun(home: string, project: string, fields: Record<string, unknown>): void {
  const run = { project, task: 't1', name: 'Task one', url: 'u', startedAt: '2026-09-27T09:00:00.000Z', finishedAt: '2026-09-27T09:30:00.000Z', durationMs: 1, costUsd: null, needs: 'test', status: 'qa', summary: '', tests: null, verdict: 'manual', worktree: '/wt', log: '/l', ...fields };
  appendFileSync(join(home, 'runs.jsonl'), `${JSON.stringify(run)}\n`);
}

test('with a merge level, approving a task queues its merge with the commit of its last run', async () => {
  const { home, project, act } = setup({ merge: 'dev' });
  recordRun(home, project, { branch: 'feat/old', pr: 10, sha: 'old111', finishedAt: '2026-09-26T09:00:00.000Z' });
  recordRun(home, project, { branch: 'feat/discount', pr: 12, sha: 'abc123' });
  await act({ project, task: 't1', action: 'approve' });
  assert.deepEqual(readMerges(home).map((entry) => [entry.task, entry.branch, entry.pr, entry.sha, entry.approvedBy]), [['t1', 'feat/discount', 12, 'abc123', 'person']]);
});

test('without a merge level, or without a pull request in the last run, approving queues nothing', async () => {
  for (const [options, fields] of [[{}, { branch: 'feat/discount', pr: 12, sha: 'abc123' }], [{ merge: 'dev' }, { branch: null, pr: null, sha: null }]] as const) {
    const { home, project, act, taskwire } = setup(options);
    recordRun(home, project, fields);
    await act({ project, task: 't1', action: 'approve' });
    assert.deepEqual(readMerges(home), []);
    assert.deepEqual(writes(taskwire.calls), [['task', 'update', 't1', '--needs', 'none']]);
  }
});

test('sending back or blocking a task drops its queued merge', async () => {
  for (const action of ['send-back', 'block'] as const) {
    const { home, project, act } = setup({ merge: 'dev' });
    writeMerges(home, [{ project, task: 't1', name: 'Task one', branch: 'feat/discount', pr: 12, url: '', sha: 'abc123', approvedBy: 'person', queuedAt: '2026-09-27T09:00:00.000Z' }]);
    await act({ project, task: 't1', action, text: 'Round the total down.' });
    assert.deepEqual(readMerges(home), [], action);
  }
});

test('approving a task whose last run failed its checks queues nothing: the person merges it', async () => {
  for (const verdict of ['fail', null]) {
    const { home, project, act } = setup({ merge: 'dev' });
    appendFileSync(join(home, 'runs.jsonl'), `${JSON.stringify({ project, task: 'r1', name: 'Task', url: 'u', startedAt: 's', finishedAt: '2026-09-27T09:30:00.000Z', durationMs: 1, costUsd: null, needs: 'review', status: 'qa', summary: '', tests: 'fail', verdict, worktree: '/wt', log: '/l', branch: 'feat/x', pr: 13, sha: 'def456' })}\n`);
    await act({ project, task: 'r1', action: 'approve' });
    assert.deepEqual(readMerges(home), [], String(verdict));
  }
});

test('a live task is closed from the dashboard, and a task that is not live is refused', async () => {
  const home = tempDir('home');
  const project = projectDir('shop');
  writeFileSync(join(home, 'config.json'), JSON.stringify({ projects: [{ path: project }] }));
  writeFileSync(join(home, 'live.json'), JSON.stringify({ live: [{ project, task: 'l1', name: 'Show the total', url: 'u', pr: 12, at: '2026-09-28T09:30:00.000Z' }], closed: [], merged: {}, asked: {} }));
  const taskwire = fakeTaskwire({
    tasks: [task({ id: 'l1', status: 'qa', list: { id: 'l1list', name: 'Backlog' } }), task({ id: 'o1', status: 'qa' })],
    lists: [{ id: 'l1list', name: 'Backlog', statuses: ['backlog', 'qa', 'complete'] }],
    'task update': {},
    'comment add': { id: 'c1' },
  });
  const act = createActions({ home, runTaskwire: taskwire.run, onChange: () => {} });
  await act({ project, task: 'l1', action: 'close-live' });
  assert.deepEqual(writes(taskwire.calls).filter((args) => args[0] !== 'lists'), [
    ['comment', 'add', 'l1', '--text', 'Answer from the person, via the dashboard:\n\nClosed: the work is in production.'],
    ['task', 'update', 'l1', '--needs', 'none', '--status', 'complete'],
  ]);
  assert.deepEqual(JSON.parse(readFileSync(join(home, 'live.json'), 'utf8')).live, []);
  await assert.rejects(act({ project, task: 'o1', action: 'close-live' }), (error: unknown) => error instanceof OrchestratorError && /is not live/.test(error.message));
});
