import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadListInFolder, loadTaskInFolder, normalizeTaskId } from '../src/guard.ts';
import { TaskwireError } from '../src/errors.ts';
import { FOLDER_ID, OTHER_FOLDER_ID, rawList, rawTask, testClient } from './helpers.ts';

test('normalizeTaskId strips a leading # copied from the UI', () => {
  assert.equal(normalizeTaskId('#86c1abc'), '86c1abc');
  assert.equal(normalizeTaskId(' 86c1abc '), '86c1abc');
});

test('normalizeTaskId rejects empty or spaced ids', () => {
  for (const bad of ['', '#', 'a b']) {
    assert.throws(() => normalizeTaskId(bad), (e: unknown) => e instanceof TaskwireError && e.exitCode === 2, bad);
  }
});

test('loadTaskInFolder returns the task when the folder matches, asking for subtasks and markdown', async () => {
  const { client, calls } = testClient({ 'GET /task/t1': { body: rawTask() } });
  const task = await loadTaskInFolder(client, '#t1', FOLDER_ID);
  assert.equal(task.id, 't1');
  assert.equal(calls[0].url.searchParams.get('include_subtasks'), 'true');
  assert.equal(calls[0].url.searchParams.get('include_markdown_description'), 'true');
});

test('loadTaskInFolder refuses a task from another folder', async () => {
  const { client } = testClient({
    'GET /task/t1': { body: rawTask({ folder: { id: OTHER_FOLDER_ID, name: 'Other project' } }) },
  });
  await assert.rejects(loadTaskInFolder(client, 't1', FOLDER_ID), (e: unknown) =>
    e instanceof TaskwireError && e.exitCode === 3 && (e.hint ?? '').includes('Other project'));
});

test('loadListInFolder refuses a list from another folder', async () => {
  const { client } = testClient({ 'GET /list/800': { body: rawList({ folder: { id: OTHER_FOLDER_ID } }) } });
  await assert.rejects(loadListInFolder(client, '800', FOLDER_ID), (e: unknown) =>
    e instanceof TaskwireError && e.exitCode === 3);
});

test('loadListInFolder rejects a non numeric list id before calling ClickUp', async () => {
  const { client, calls } = testClient({});
  await assert.rejects(loadListInFolder(client, 'abc', FOLDER_ID), (e: unknown) =>
    e instanceof TaskwireError && e.exitCode === 2);
  assert.equal(calls.length, 0);
});

test('loadTaskInFolder with listIds refuses a task from another list of the folder', async () => {
  const { client } = testClient({ 'GET /task/t1': { body: rawTask({ list: { id: '803', name: 'Other project' } }) } });
  await assert.rejects(loadTaskInFolder(client, 't1', FOLDER_ID, ['800', '802']), (e: unknown) =>
    e instanceof TaskwireError && e.exitCode === 3 && e.message.includes("project's lists") &&
    (e.hint ?? '').includes('800, 802') && (e.hint ?? '').includes('Other project'));
});

test('loadTaskInFolder with listIds still refuses a task from another folder', async () => {
  const { client } = testClient({
    'GET /task/t1': { body: rawTask({ folder: { id: OTHER_FOLDER_ID, name: 'Other' } }) },
  });
  await assert.rejects(loadTaskInFolder(client, 't1', FOLDER_ID, ['800']), (e: unknown) =>
    e instanceof TaskwireError && e.exitCode === 3 && e.message.includes('folder'));
});

test('loadTaskInFolder with listIds returns a task of one of the lists', async () => {
  const { client } = testClient({ 'GET /task/t1': { body: rawTask() } });
  assert.equal((await loadTaskInFolder(client, 't1', FOLDER_ID, ['802', '800'])).id, 't1');
});

test('loadListInFolder with listIds refuses another list of the folder', async () => {
  const { client } = testClient({ 'GET /list/803': { body: rawList({ id: '803', name: 'Other project' }) } });
  await assert.rejects(loadListInFolder(client, '803', FOLDER_ID, ['800']), (e: unknown) =>
    e instanceof TaskwireError && e.exitCode === 3 && e.message.includes("project's lists"));
});
