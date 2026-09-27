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
