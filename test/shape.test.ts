import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toList, toTask, toTaskDetail } from '../src/shape.ts';
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
  }));
  assert.deepEqual(summary, {
    id: 't1',
    name: 'Task one',
    status: 'to do',
    priority: 'high',
    tags: ['backend'],
    assignees: [{ id: 7, username: 'jane' }],
    due: '2026-01-01T01:00:00+01:00',
    list: { id: '800', name: 'Backlog' },
    parent: 'p1',
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
    [{ id: '55', comment_text: 'Done', user: { id: 7, username: 'jane' }, date: '1767225600000' }],
  );
  assert.equal(detail.description, '# Hello');
  assert.deepEqual(detail.subtasks.map((s) => s.id), ['s1']);
  assert.deepEqual(detail.checklists, [{ id: 'c1', name: 'Steps', items: [{ id: 'i1', name: 'One', resolved: true }] }]);
  assert.deepEqual(detail.dependencies, { blockedBy: ['b1'], blocking: ['x9'] });
  assert.deepEqual(detail.comments, [{ id: '55', author: 'jane', date: '2026-01-01T00:00:00.000Z', text: 'Done' }]);
});

test('toTaskDetail falls back to the plain description and empty collections', () => {
  const detail = toTaskDetail(rawTask({ description: 'Plain' }), []);
  assert.equal(detail.description, 'Plain');
  assert.deepEqual(detail.subtasks, []);
  assert.deepEqual(detail.checklists, []);
  assert.deepEqual(detail.dependencies, { blockedBy: [], blocking: [] });
});

test('toList returns status names', () => {
  assert.deepEqual(toList(rawList()), { id: '800', name: 'Backlog', statuses: ['to do', 'in progress', 'complete'] });
  assert.deepEqual(toList(rawList({ statuses: undefined })).statuses, []);
});

test('toTaskDetail accepts subtasks as ClickUp nests them, without list, folder or priority', () => {
  const { list, folder, priority, ...nested } = rawTask({ id: 's1', name: 'Sub', parent: 't1' });
  const detail = toTaskDetail(rawTask({ subtasks: [nested] }), []);
  assert.deepEqual(detail.subtasks[0].list, { id: '800', name: 'Backlog' });
  assert.equal(detail.subtasks[0].priority, null);
});
