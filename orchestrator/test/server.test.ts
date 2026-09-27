import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../src/dashboard/server.ts';
import type { DashboardState } from '../src/dashboard/snapshot.ts';

const state: DashboardState = {
  generatedAt: '2026-09-27T15:32:00.000Z',
  agentsRunning: true,
  working: [],
  waiting: [{ project: '/code/shop', projectName: 'shop', id: 'd1', name: '<img src=x onerror=alert(1)>', url: 'https://app.clickup.com/t/d1', needs: 'decision', status: 'backlog', note: [] }],
  history: [],
  problems: [],
};

const handler = createHandler({ snapshot: async () => state, token: 'secret-token' });
const get = (url: string, host = '127.0.0.1:4777') => handler({ method: 'GET', url, headers: { host }, body: '' });

test('the page is served as HTML, with the current state embedded for the first paint', async () => {
  const response = await get('/');
  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'] ?? '', /text\/html/);
  assert.match(response.body, /taskwire orchestrator/);
  assert.match(response.body, /"generatedAt":"2026-09-27T15:32:00.000Z"/);
});

test('task text from the task system is never turned into HTML', async () => {
  const response = await get('/');
  assert.ok(!response.body.includes('<img src=x'), 'the embedded state escapes "<"');
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML|document\.write/.test(response.body), 'the page builds the DOM with text only');
});

test('the state is served as JSON for the page to refresh', async () => {
  const response = await get('/api/state');
  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'] ?? '', /application\/json/);
  assert.deepEqual(JSON.parse(response.body), state);
});

test('requests for another host are refused, against DNS rebinding', async () => {
  for (const host of ['evil.example.com', 'evil.example.com:4777', '192.168.1.20:4777']) {
    assert.equal((await get('/api/state', host)).status, 403, host);
  }
  assert.equal((await get('/api/state', 'localhost:4777')).status, 200);
});

test('an unknown path is a 404', async () => {
  assert.equal((await get('/nope')).status, 404);
});
