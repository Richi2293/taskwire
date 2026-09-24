import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OTHER_FOLDER_ID, rawTask, runCli } from './helpers.ts';

const task = { 'GET /task/t1': { body: rawTask() } };

test('comment add posts the text without notifying everyone', async () => {
  const run = await runCli(['comment', 'add', 't1', '--text', 'Done in abc123'], { routes: {
    ...task, 'POST /task/t1/comment': { body: { id: 99, hist_id: 'h', date: 0 } },
  } });
  assert.equal(run.code, 0);
  assert.deepEqual(run.calls[1].body, { comment_text: 'Done in abc123', notify_all: false });
  assert.deepEqual(run.json(), { id: '99', taskId: 't1' });
});

test('comment add reads the text from a file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'taskwire-comment-'));
  writeFileSync(join(dir, 'c.md'), 'From file');
  const run = await runCli(['comment', 'add', 't1', '--file', join(dir, 'c.md')], { routes: {
    ...task, 'POST /task/t1/comment': { body: { id: 1 } },
  } });
  assert.equal((run.calls[1].body as { comment_text: string }).comment_text, 'From file');
});

test('comment add needs exactly one of --text or --file', async () => {
  assert.equal((await runCli(['comment', 'add', 't1'])).code, 2);
  assert.equal((await runCli(['comment', 'add', 't1', '--text', 'a', '--file', 'b'])).code, 2);
});

const comments = {
  'GET /task/t1/comment': { body: { comments: [
    { id: '5', comment_text: 'Old', user: { id: 7, username: 'jane' }, date: '0', assignee: null, resolved: false },
    { id: '6', comment_text: 'Todo', user: { id: 7, username: 'jane' }, date: '0', assignee: { id: 8, username: 'john' }, resolved: true },
  ] } },
};

test('comment update replaces the text and keeps resolved', async () => {
  const run = await runCli(['comment', 'update', '5', '--task', 't1', '--text', 'New'], { routes: {
    ...task, ...comments, 'PUT /comment/5': { body: {} },
  } });
  assert.equal(run.code, 0);
  assert.deepEqual(run.calls[2].body, { comment_text: 'New', resolved: false });
  assert.deepEqual(run.json(), { id: '5', taskId: 't1' });
});

test('comment update keeps the current assignee', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'taskwire-comment-'));
  writeFileSync(join(dir, 'c.md'), 'From file');
  const run = await runCli(['comment', 'update', '6', '--task', 't1', '--file', join(dir, 'c.md')], { routes: {
    ...task, ...comments, 'PUT /comment/6': { body: {} },
  } });
  assert.equal(run.code, 0);
  assert.deepEqual(run.calls[2].body, { comment_text: 'From file', resolved: true, assignee: 8 });
});

test('comment update with a comment not in the task exits 2', async () => {
  const run = await runCli(['comment', 'update', '99', '--task', 't1', '--text', 'New'], { routes: { ...task, ...comments } });
  assert.equal(run.code, 2);
  assert.equal(run.calls.filter((c) => c.method === 'PUT').length, 0);
});

test('comment update of a task in another folder exits 3', async () => {
  const run = await runCli(['comment', 'update', '5', '--task', 't1', '--text', 'New'], { routes: {
    'GET /task/t1': { body: rawTask({ folder: { id: OTHER_FOLDER_ID, name: 'Other' } }) },
  } });
  assert.equal(run.code, 3);
  assert.equal(run.calls.filter((c) => c.method === 'PUT').length, 0);
});

test('comment update needs --task and exactly one of --text or --file', async () => {
  assert.equal((await runCli(['comment', 'update', '5', '--task', 't1'])).code, 2);
  assert.equal((await runCli(['comment', 'update', '5', '--task', 't1', '--text', 'a', '--file', 'b'])).code, 2);
  assert.equal((await runCli(['comment', 'update', '5', '--text', 'a'])).code, 2);
});

test('checklist add creates the checklist and its items', async () => {
  const checklist = { id: 'c1', name: 'Steps', items: [] };
  const run = await runCli(['checklist', 'add', 't1', '--name', 'Steps', '--item', 'One', '--item', 'Two'], { routes: {
    ...task,
    'POST /task/t1/checklist': { body: { checklist } },
    'POST /checklist/c1/checklist_item': (call) => ({
      body: { checklist: { ...checklist, items: [{ id: 'i1', name: (call.body as { name: string }).name, resolved: false }] } },
    }),
  } });
  assert.equal(run.code, 0);
  const itemCalls = run.calls.filter((c) => c.path === '/checklist/c1/checklist_item');
  assert.deepEqual(itemCalls.map((c) => c.body), [{ name: 'One' }, { name: 'Two' }]);
});

test('checklist check resolves the item inside the task checklist', async () => {
  const run = await runCli(['checklist', 'check', 'i1', '--task', 't1'], { routes: {
    'GET /task/t1': { body: rawTask({ checklists: [{ id: 'c1', name: 'S', items: [{ id: 'i1', name: 'One', resolved: false }] }] }) },
    'PUT /checklist/c1/checklist_item/i1': { body: { checklist: { id: 'c1', name: 'S', items: [{ id: 'i1', name: 'One', resolved: true }] } } },
  } });
  assert.equal(run.code, 0);
  assert.deepEqual(run.calls[1].body, { resolved: true });
});

test('checklist check with an item not in the task exits 2', async () => {
  const run = await runCli(['checklist', 'check', 'zz', '--task', 't1'], { routes: task });
  assert.equal(run.code, 2);
});

test('dependency add checks both tasks then posts depends_on', async () => {
  const run = await runCli(['dependency', 'add', 't1', '--blocked-by', 'b1'], { routes: {
    ...task,
    'GET /task/b1': { body: rawTask({ id: 'b1' }) },
    'POST /task/t1/dependency': { body: {} },
  } });
  assert.equal(run.code, 0);
  assert.deepEqual(run.calls[2].body, { depends_on: 'b1' });
});

test('dependency add refuses a blocker from another folder', async () => {
  const run = await runCli(['dependency', 'add', 't1', '--blocked-by', 'b1'], { routes: {
    ...task,
    'GET /task/b1': { body: rawTask({ id: 'b1', folder: { id: OTHER_FOLDER_ID, name: 'Other' } }) },
  } });
  assert.equal(run.code, 3);
  assert.equal(run.calls.filter((c) => c.method === 'POST').length, 0);
});

test('dependency remove sends depends_on as a query parameter', async () => {
  const run = await runCli(['dependency', 'remove', 't1', '--blocked-by', 'b1'], { routes: {
    ...task,
    'GET /task/b1': { body: rawTask({ id: 'b1' }) },
    'DELETE /task/t1/dependency': { body: {} },
  } });
  assert.equal(run.code, 0);
  assert.equal(run.calls[2].url.searchParams.get('depends_on'), 'b1');
});
