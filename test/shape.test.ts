import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusFlow, toList, toTask, toTaskDetail } from '../src/shape.ts';
import type { ListFlow } from '../src/shape.ts';
import { rawList, rawTask } from './helpers.ts';

test('toTask keeps only the useful fields, with the due date in the system time zone', () => {
  const previous = process.env.TZ;
  process.env.TZ = 'Europe/Berlin';
  const summary = toTask(rawTask({
    priority: { priority: 'high' },
    tags: [{ name: 'backend' }],
    assignees: [{ id: 7, username: 'jane', email: 'x@y.z' }],
    due_date: '1767225600000',
    parent: 'p1',
    dependencies: [
      { task_id: 't1', depends_on: 'b1' },
      { task_id: 'x9', depends_on: 't1' },
    ],
  }));
  assert.deepEqual(summary, {
    id: 't1',
    name: 'Task one',
    status: 'to do',
    priority: 'high',
    tags: ['backend'],
    needs: null,
    assignees: [{ id: 7, username: 'jane' }],
    due: '2026-01-01T01:00:00+01:00',
    list: { id: '800', name: 'Backlog' },
    parent: 'p1',
    blockedBy: ['b1'],
    url: 'https://app.clickup.com/t/t1',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  if (previous === undefined) delete process.env.TZ;
  else process.env.TZ = previous;
});

test('toTaskDetail adds description, subtasks, checklists, dependencies and comments', () => {
  const detail = toTaskDetail(
    rawTask({
      markdown_description: '# Hello',
      description: 'Hello',
      subtasks: [rawTask({ id: 's1', name: 'Sub', parent: 't1' })],
      checklists: [{ id: 'c1', name: 'Steps', items: [{ id: 'i1', name: 'One', resolved: true }] }],
      dependencies: [
        { task_id: 't1', depends_on: 'b1' },
        { task_id: 'x9', depends_on: 't1' },
      ],
    }),
    [
      { id: '55', comment_text: 'Done', user: { id: 7, username: 'jane' }, date: '1767225600000' },
      { id: '56', comment_text: 'Check', user: { id: 7, username: 'jane' }, date: '0', resolved: true, assignee: { id: 8, username: 'john' } },
    ],
  );
  assert.equal(detail.description, '# Hello');
  assert.deepEqual(detail.subtasks.map((s) => s.id), ['s1']);
  assert.deepEqual(detail.checklists, [{ id: 'c1', name: 'Steps', items: [{ id: 'i1', name: 'One', resolved: true }] }]);
  assert.deepEqual(detail.dependencies, { blockedBy: ['b1'], blocking: ['x9'] });
  assert.deepEqual(detail.comments, [
    { id: '55', author: 'jane', date: '2026-01-01T00:00:00.000Z', text: 'Done', resolved: false, assignee: null },
    { id: '56', author: 'jane', date: '1970-01-01T00:00:00.000Z', text: 'Check', resolved: true, assignee: { id: 8, username: 'john' } },
  ]);
});

test('toTaskDetail falls back to the plain description and empty collections', () => {
  const detail = toTaskDetail(rawTask({ description: 'Plain' }), []);
  assert.equal(detail.description, 'Plain');
  assert.deepEqual(detail.subtasks, []);
  assert.deepEqual(detail.checklists, []);
  assert.deepEqual(detail.dependencies, { blockedBy: [], blocking: [] });
});

test('toList returns status names and the status of each step of the flow', () => {
  assert.deepEqual(toList(rawList()), {
    id: '800',
    name: 'Backlog',
    statuses: ['to do', 'in progress', 'complete'],
    flow: { backlog: 'to do', todo: null, inProgress: 'in progress', review: null, closed: 'complete' },
  });
  assert.deepEqual(toList(rawList({ statuses: undefined })), {
    id: '800',
    name: 'Backlog',
    statuses: [],
    flow: { backlog: null, todo: null, inProgress: null, review: null, closed: null },
  });
});

// Statuses written as "name:type", in the order of the list.
function flowOf(...statuses: string[]): ListFlow {
  return statusFlow(statuses.map((entry) => {
    const [status, type] = entry.split(':');
    return { status, type };
  }));
}

test('statusFlow maps every step of a list with the whole flow', () => {
  assert.deepEqual(flowOf('backlog:open', 'to do:custom', 'in progress:custom', 'qa:done', 'complete:closed'), {
    backlog: 'backlog', todo: 'to do', inProgress: 'in progress', review: 'qa', closed: 'complete',
  });
});

test('statusFlow takes the review step from a custom status by its name when the list has no done status', () => {
  assert.deepEqual(flowOf('open:open', 'doing:custom', 'in review:custom', 'closed:closed'), {
    backlog: 'open', todo: null, inProgress: 'doing', review: 'in review', closed: 'closed',
  });
});

test('statusFlow uses the first done status for review', () => {
  assert.equal(flowOf('open:open', 'qa:done', 'ready to ship:done', 'closed:closed').review, 'qa');
});

test('statusFlow takes the only custom status left as in progress, whatever its name', () => {
  assert.equal(flowOf('open:open', 'working on it:custom', 'closed:closed').inProgress, 'working on it');
  assert.equal(flowOf('open:open', 'busy:custom', 'closed:closed').inProgress, 'busy');
});

test('statusFlow leaves a step null when the names do not tell which status it is', () => {
  assert.deepEqual(flowOf('open:open', 'blocked:custom', 'busy:custom', 'closed:closed'), {
    backlog: 'open', todo: null, inProgress: null, review: null, closed: 'closed',
  });
  assert.deepEqual(flowOf('open:open', 'blocked:custom', 'in progress:custom', 'closed:closed'), {
    backlog: 'open', todo: null, inProgress: 'in progress', review: null, closed: 'closed',
  });
});

test('statusFlow takes todo only from a status before in progress', () => {
  assert.equal(flowOf('open:open', 'in progress:custom', 'ready:custom', 'closed:closed').todo, null);
  assert.equal(flowOf('open:open', 'Ready for dev:custom', 'In Progress:custom', 'closed:closed').todo, 'Ready for dev');
});

test('statusFlow gives each status at most one step', () => {
  assert.deepEqual(flowOf('to do:open', 'complete:closed'), {
    backlog: 'to do', todo: null, inProgress: null, review: null, closed: 'complete',
  });
  assert.deepEqual(flowOf('open:open', 'qa:custom', 'closed:closed'), {
    backlog: 'open', todo: null, inProgress: null, review: 'qa', closed: 'closed',
  });
});

test('toTaskDetail accepts subtasks as ClickUp nests them, without list, folder or priority', () => {
  const { list, folder, priority, ...nested } = rawTask({ id: 's1', name: 'Sub', parent: 't1' });
  const detail = toTaskDetail(rawTask({ subtasks: [nested] }), []);
  assert.deepEqual(detail.subtasks[0].list, { id: '800', name: 'Backlog' });
  assert.equal(detail.subtasks[0].priority, null);
});
