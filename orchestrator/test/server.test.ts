import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../src/dashboard/server.ts';
import { OrchestratorError } from '../src/errors.ts';
import { createRunControl } from '../src/control.ts';
import type { DashboardState } from '../src/dashboard/snapshot.ts';

const state: DashboardState = {
  generatedAt: '2026-09-27T15:32:00.000Z',
  control: { mode: 'paused', intervalMinutes: 5, maxAgents: 2, agentsAtWork: 0, nextCheckAt: null, busyProjects: [], firstTask: null },
  projects: [],
  working: [],
  waiting: [{
    project: '/code/shop', projectName: 'shop', id: 'd1', name: '<img src=x onerror=alert(1)>', url: 'https://app.clickup.com/t/d1', needs: 'decision', status: 'backlog',
    goal: null, since: null, note: [], questions: [], proposal: null, checked: [], byHand: [],
  }],
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
  // The switch between paused and working is on the page.
  assert.match(response.body, /Start agents/);
  assert.match(response.body, /\/api\/control/);
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

function withActions(act: (body: unknown) => Promise<void>) {
  return createHandler({ snapshot: async () => state, token: 'secret-token', act });
}

const post = (handle: ReturnType<typeof withActions>, body: string, token?: string) =>
  handle({
    method: 'POST',
    url: '/api/action',
    headers: { host: '127.0.0.1:4777', 'content-type': 'application/json', ...(token === undefined ? {} : { 'x-action-token': token }) },
    body,
  });

test('an action needs the token of this start, so another page cannot send one', async () => {
  const received: unknown[] = [];
  const handle = withActions(async (body) => { received.push(body); });
  assert.equal((await post(handle, '{"project":"/p","task":"t1","action":"approve"}')).status, 403);
  assert.equal((await post(handle, '{"project":"/p","task":"t1","action":"approve"}', 'guess')).status, 403);
  assert.deepEqual(received, []);
  const ok = await post(handle, '{"project":"/p","task":"t1","action":"approve"}', 'secret-token');
  assert.equal(ok.status, 200);
  assert.deepEqual(JSON.parse(ok.body), { ok: true });
  assert.deepEqual(received, [{ project: '/p', task: 't1', action: 'approve' }]);
});

test('an action that is not JSON, or that is refused, answers 400 with the reason', async () => {
  const handle = withActions(async () => {
    throw new OrchestratorError('Task t1 does not wait for a decision', 2);
  });
  assert.equal((await post(handle, 'not json', 'secret-token')).status, 400);
  const refused = await post(handle, '{"project":"/p","task":"t1","action":"answer","text":"x"}', 'secret-token');
  assert.equal(refused.status, 400);
  assert.deepEqual(JSON.parse(refused.body), { error: 'Task t1 does not wait for a decision' });
});

test('a failure of taskwire during an action answers 502', async () => {
  const handle = withActions(async () => {
    throw new OrchestratorError('taskwire task: Network error calling ClickUp', 1);
  });
  assert.equal((await post(handle, '{"project":"/p","task":"t1","action":"approve"}', 'secret-token')).status, 502);
});

test('start working and pause need the token, and switch the run control', async () => {
  const control = createRunControl();
  const handle = createHandler({ snapshot: async () => state, token: 'secret-token', control });
  const send = (action: string, token?: string) => handle({
    method: 'POST',
    url: '/api/control',
    headers: { host: '127.0.0.1', ...(token === undefined ? {} : { 'x-action-token': token }) },
    body: JSON.stringify({ action }),
  });
  assert.equal((await send('play')).status, 403);
  assert.equal(control.working(), false);
  const played = await send('play', 'secret-token');
  assert.deepEqual(JSON.parse(played.body), { ok: true, mode: 'working' });
  assert.equal(control.working(), true);
  assert.deepEqual(JSON.parse((await send('pause', 'secret-token')).body), { ok: true, mode: 'paused' });
  assert.equal((await send('fly', 'secret-token')).status, 400);
});

test('every action from the page is reported with its outcome, without the text the person wrote', async () => {
  const events: unknown[] = [];
  const act = async (body: unknown) => {
    const { task } = body as { task: string };
    if (task === 'refused') throw new OrchestratorError('Task refused does not wait for a person any more', 2);
    if (task === 'failed') throw new OrchestratorError('taskwire comment: Network error calling ClickUp', 1);
  };
  const handle = createHandler({ snapshot: async () => state, token: 'secret-token', act, onAction: (event) => events.push(event) });
  const body = (task: string) => JSON.stringify({ project: '/p', task, action: 'answer', text: 'private words' });
  await post(handle, body('ok'), 'secret-token');
  await post(handle, body('refused'), 'secret-token');
  await post(handle, body('failed'), 'secret-token');
  await post(handle, body('ok'), 'wrong-token');
  assert.deepEqual(events, [
    { project: '/p', task: 'ok', action: 'answer', outcome: 'done' },
    { project: '/p', task: 'refused', action: 'answer', outcome: 'refused', error: 'Task refused does not wait for a person any more' },
    { project: '/p', task: 'failed', action: 'answer', outcome: 'failed', error: 'taskwire comment: Network error calling ClickUp' },
    { project: null, task: null, action: null, outcome: 'refused', error: 'Reload the dashboard: this page is from an earlier start' },
  ]);
  assert.ok(!JSON.stringify(events).includes('private words'));
});
