import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUrl, createClient } from '../src/client.ts';
import { TaskwireError } from '../src/errors.ts';
import { fakeFetch, sequence, testClient } from './helpers.ts';

test('buildUrl encodes arrays as repeated key[] params and skips undefined', () => {
  const url = new URL(buildUrl('https://api.clickup.com/api/v2', '/team/1/task', {
    project_ids: ['9', '10'],
    page: 0,
    include_closed: false,
    tag: undefined,
  }));
  assert.deepEqual(url.searchParams.getAll('project_ids[]'), ['9', '10']);
  assert.equal(url.searchParams.get('page'), '0');
  assert.equal(url.searchParams.get('include_closed'), 'false');
  assert.equal(url.searchParams.has('tag'), false);
});

test('sends the token, JSON body and parses the JSON response', async () => {
  const { fetch, calls } = fakeFetch({ 'POST /list/1/task': { body: { id: 'abc' } } });
  let seenAuth: string | null = null;
  const client = createClient({
    token: 'pk_x',
    fetch: async (url, init) => {
      seenAuth = new Headers(init.headers).get('Authorization');
      return fetch(url, init);
    },
    sleep: async () => {},
    now: () => 0,
    warn: () => {},
  });
  const result = await client.request<{ id: string }>('POST', '/list/1/task', { body: { name: 'A' } });
  assert.deepEqual(result, { id: 'abc' });
  assert.equal(seenAuth, 'pk_x');
  assert.deepEqual(calls[0].body, { name: 'A' });
});

test('returns an empty object for an empty 200 body', async () => {
  const { client } = testClient({ 'DELETE /task/1': { status: 200 } });
  assert.deepEqual(await client.request('DELETE', '/task/1'), {});
});

test('turns a ClickUp error into an api error with ECODE', async () => {
  const { client } = testClient({ 'GET /task/x': { status: 404, body: { err: 'Task not found', ECODE: 'ITEM_013' } } });
  await assert.rejects(client.request('GET', '/task/x'), (e: unknown) =>
    e instanceof TaskwireError && e.exitCode === 1 && e.message === 'ClickUp API 404: Task not found (ITEM_013)');
});

test('sends a request to the v3 api when asked', async () => {
  const { client, calls } = testClient({ 'PUT /v3/workspaces/1/tasks/t1/home_list/2': { body: { data: {} } } });
  await client.request('PUT', '/workspaces/1/tasks/t1/home_list/2', { api: 'v3' });
  assert.equal(calls[0].url.href, 'https://api.clickup.com/api/v3/workspaces/1/tasks/t1/home_list/2');
});

test('turns a v3 error message into an api error', async () => {
  const { client } = testClient({
    'PUT /v3/x': { status: 400, body: { status: 400, message: 'Only root tasks can be moved to a new home list' } },
  });
  await assert.rejects(client.request('PUT', '/x', { api: 'v3' }), (e: unknown) =>
    e instanceof TaskwireError && e.message === 'ClickUp API 400: Only root tasks can be moved to a new home list');
});

test('401 gives a hint to regenerate the token', async () => {
  const { client } = testClient({ 'GET /user': { status: 401, body: { err: 'Token invalid', ECODE: 'OAUTH_025' } } });
  await assert.rejects(client.request('GET', '/user'), (e: unknown) =>
    e instanceof TaskwireError && (e.hint ?? '').includes('Settings > Apps'));
});

test('on 429 waits until reset and retries once', async () => {
  const route = sequence(
    { status: 429, headers: { 'X-RateLimit-Reset': String(1_000_000 / 1000 + 5) } },
    { body: { ok: true } },
  );
  const { client, calls, sleeps, warnings } = testClient({ 'GET /user': route });
  assert.deepEqual(await client.request('GET', '/user'), { ok: true });
  assert.equal(calls.length, 2);
  assert.deepEqual(sleeps, [5000]);
  assert.deepEqual(warnings, ['ClickUp rate limit reached, waiting 5 seconds']);
});

test('on 429 with a wait longer than 60 seconds fails without retrying', async () => {
  const { client, calls, sleeps } = testClient({
    'GET /user': { status: 429, headers: { 'X-RateLimit-Reset': String(1_000_000 / 1000 + 120) } },
  });
  await assert.rejects(client.request('GET', '/user'), (e: unknown) =>
    e instanceof TaskwireError && e.exitCode === 1 && (e.hint ?? '').includes('120'));
  assert.equal(calls.length, 1);
  assert.deepEqual(sleeps, []);
});

test('on a second 429 fails instead of looping', async () => {
  const { client, calls } = testClient({
    'GET /user': { status: 429, headers: { 'X-RateLimit-Reset': String(1_000_000 / 1000 + 1) } },
  });
  await assert.rejects(client.request('GET', '/user'), (e: unknown) => e instanceof TaskwireError && e.exitCode === 1);
  assert.equal(calls.length, 2);
});

test('a network failure becomes an api error', async () => {
  const client = createClient({
    token: 'pk_x',
    fetch: async () => {
      throw new TypeError('fetch failed');
    },
    sleep: async () => {},
    now: () => 0,
    warn: () => {},
  });
  await assert.rejects(client.request('GET', '/user'), (e: unknown) =>
    e instanceof TaskwireError && e.exitCode === 1 && e.message.includes('fetch failed'));
});

test('on 429 without a reset header waits 60 seconds and says so', async () => {
  const route = sequence({ status: 429 }, { body: { user: { id: 1 } } });
  const { client, sleeps, warnings } = testClient({ 'GET /user': route });
  await client.request('GET', '/user');
  assert.deepEqual(sleeps, [60_000]);
  assert.deepEqual(warnings, ['ClickUp rate limit reached, waiting 60 seconds']);
});
