import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickTask } from '../src/picker.ts';
import { task } from './helpers.ts';

const options = { statuses: ['backlog', 'to do'], blockTag: 'no-agent' };

test('picks nothing from an empty list', () => {
  assert.equal(pickTask([], options), null);
});

test('picks only tasks in a start status, ignoring case', () => {
  const tasks = [task({ id: 'doing', status: 'in progress' }), task({ id: 'todo', status: 'To Do' }), task({ id: 'done', status: 'qa' })];
  assert.equal(pickTask(tasks, options)?.id, 'todo');
});

test('leaves out tasks waiting for a person and tasks with the block tag', () => {
  const tasks = [task({ id: 'waits', needs: 'decision' }), task({ id: 'blocked', tags: ['no-agent'] }), task({ id: 'free' })];
  assert.equal(pickTask(tasks, options)?.id, 'free');
});

test('leaves out a task whose subtasks are in the list, since the work is in the subtasks', () => {
  const tasks = [task({ id: 'sub', parent: 'epic', status: 'qa' }), task({ id: 'epic' }), task({ id: 'single' })];
  assert.equal(pickTask(tasks, options)?.id, 'single');
});

test('picks the highest priority first, tasks without priority last', () => {
  const tasks = [task({ id: 'none', priority: null }), task({ id: 'low', priority: 'low' }), task({ id: 'urgent', priority: 'urgent' }), task({ id: 'high', priority: 'high' })];
  assert.equal(pickTask(tasks, options)?.id, 'urgent');
  assert.equal(pickTask(tasks.filter((t) => t.id !== 'urgent'), options)?.id, 'high');
  assert.equal(pickTask([tasks[0], tasks[1]], options)?.id, 'low');
});

// taskwire lists the most recently created tasks first, so the oldest one is the last in the list.
test('with the same priority, picks the oldest task', () => {
  const tasks = [task({ id: 'newest' }), task({ id: 'older' }), task({ id: 'oldest' })];
  assert.equal(pickTask(tasks, options)?.id, 'oldest');
});

test('a project with an area picks only the tasks with its area tag', () => {
  const tasks = [task({ id: 'backend', tags: ['be'] }), task({ id: 'none' }), task({ id: 'frontend', tags: ['fe', 'bug'] })];
  assert.equal(pickTask(tasks, { ...options, area: 'fe' })?.id, 'frontend');
  assert.equal(pickTask(tasks, { ...options, area: 'mobile' }), null);
  // Without an area every task may be picked, as before.
  assert.equal(pickTask(tasks, options)?.id, 'frontend');
});

test('leaves out a task that waits for an open task, and takes it once that task is closed', () => {
  const tasks = [task({ id: 'ui', blockedBy: ['api'] }), task({ id: 'api', status: 'in progress' })];
  assert.equal(pickTask(tasks, options), null);
  // A closed task is not in the list of open tasks any more.
  assert.equal(pickTask([tasks[0]], options)?.id, 'ui');
});
