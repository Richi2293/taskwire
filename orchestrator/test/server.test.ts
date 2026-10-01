import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../src/dashboard/server.ts';
import { OrchestratorError } from '../src/errors.ts';
import { createRunControl } from '../src/control.ts';
import type { DashboardState } from '../src/dashboard/snapshot.ts';

const state: DashboardState = {
  generatedAt: '2026-09-27T15:32:00.000Z',
  sync: { readAt: '2026-09-27T15:31:00.000Z', reading: false },
  control: { mode: 'paused', intervalMinutes: 5, maxAgents: 2, agentsAtWork: 0, nextCheckAt: null, busyProjects: [], firstTask: null },
  projects: [],
  working: [],
  waiting: [{
    project: '/code/shop', projectName: 'shop', id: 'd1', name: '<img src=x onerror=alert(1)>', url: 'https://app.clickup.com/t/d1', needs: 'decision', status: 'backlog',
    goal: null, since: null, note: [], questions: [], proposal: null, checked: [], byHand: [], proposedTask: null, readyToClose: null,
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
  // Projects are added and removed from the page too.
  assert.match(response.body, /Add project/);
  assert.match(response.body, /\/api\/discover/);
  assert.match(response.body, /\/api\/projects/);
  assert.match(response.body, /Remove project/);
  assert.match(response.body, /'Added ' \+/);
  // A light control bar: the brand sits above it, and the state comes in a chip.
  assert.match(response.body, /<p class="brand">[\s\S]*<header class="control"/);
  assert.match(response.body, /id="state-chip"/);
  // The page tells how old the data is and when it is being read again.
  assert.match(response.body, />Refresh<\/button>/);
  assert.match(response.body, /Updating from ClickUp/);
  assert.match(response.body, /\/api\/refresh/);
});

test('an element with the hidden attribute stays hidden, even when its class sets a display', async () => {
  const response = await get('/');
  assert.match(response.body, /\[hidden\] \{ display: none !important; \}/);
});

test('a More menu closes like a menu, and a refresh never closes it under the pointer', async () => {
  const response = await get('/');
  // A click outside, Escape or opening another menu closes it; choosing an item closes it too.
  assert.match(response.body, /function closeMenus\(/);
  assert.match(response.body, /document\.addEventListener\('click'/);
  assert.match(response.body, /event\.key === 'Escape'/);
  assert.match(response.body, /addEventListener\('toggle'/);
  // The page does not refresh while a menu is open.
  assert.match(response.body, /document\.querySelector\('details\.menu\[open\]'\)/);
});

test('each project row has a switch for its agents', async () => {
  const response = await get('/');
  assert.match(response.body, /role: 'switch'/);
  assert.match(response.body, /'agents-on' : 'agents-off'/);
  assert.match(response.body, /Agents off/);
  assert.match(response.body, /\.projects \.row\.off/);
});

test('the queue can be narrowed to some projects, and the choice is kept in the browser', async () => {
  const response = await get('/');
  assert.match(response.body, /id="project-filters"/);
  assert.match(response.body, /All projects/);
  assert.match(response.body, /Nothing waits for you in the selected projects/);
  assert.match(response.body, /localStorage\.setItem\(PROJECTS_KEY/);
  // The waiting chips of a project row narrow the queue to that project and kind.
  assert.match(response.body, /function focusQueue\(/);
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

test('following and unfollowing a project need the token, and are reported without the test command', async () => {
  const received: unknown[] = [];
  const events: unknown[] = [];
  const handle = createHandler({
    snapshot: async () => state,
    token: 'secret-token',
    projects: async (body) => {
      received.push(body);
      if ((body as { project: string }).project === '/busy') throw new OrchestratorError('An agent is working in /busy', 2);
    },
    onAction: (event) => events.push(event),
  });
  const send = (body: unknown, token?: string) => handle({
    method: 'POST',
    url: '/api/projects',
    headers: { host: '127.0.0.1', ...(token === undefined ? {} : { 'x-action-token': token }) },
    body: JSON.stringify(body),
  });
  assert.equal((await send({ action: 'follow', project: '/code/shop' })).status, 403);
  assert.deepEqual(received, []);
  const ok = await send({ action: 'follow', project: '/code/shop', testCommand: 'npm test' }, 'secret-token');
  assert.equal(ok.status, 200);
  assert.equal((await send({ action: 'unfollow', project: '/busy' }, 'secret-token')).status, 400);
  assert.deepEqual(received, [{ action: 'follow', project: '/code/shop', testCommand: 'npm test' }, { action: 'unfollow', project: '/busy' }]);
  assert.deepEqual(events, [
    { project: null, task: null, action: null, outcome: 'refused', error: 'Reload the dashboard: this page is from an earlier start' },
    { project: '/code/shop', task: null, action: 'follow', outcome: 'done' },
    { project: '/busy', task: null, action: 'unfollow', outcome: 'refused', error: 'An agent is working in /busy' },
  ]);
  assert.ok(!JSON.stringify(events).includes('npm test'));
});

test('the search for projects to add needs the token, since it lists folders of the Mac', async () => {
  const found = { roots: ['/code'], projects: [{ path: '/code/shop', name: 'shop' }], truncated: false };
  const handle = createHandler({ snapshot: async () => state, token: 'secret-token', discover: () => found });
  const ask = (token?: string) => handle({ method: 'GET', url: '/api/discover', headers: { host: '127.0.0.1', ...(token === undefined ? {} : { 'x-action-token': token }) }, body: '' });
  assert.equal((await ask()).status, 403);
  const response = await ask('secret-token');
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), found);
});

test('refresh now needs the token, and starts a read without waiting for it', async () => {
  let refreshes = 0;
  const handle = createHandler({ snapshot: async () => state, token: 'secret-token', refresh: () => { refreshes += 1; } });
  const send = (token?: string) => handle({ method: 'POST', url: '/api/refresh', headers: { host: '127.0.0.1', ...(token === undefined ? {} : { 'x-action-token': token }) }, body: '' });
  assert.equal((await send()).status, 403);
  assert.equal(refreshes, 0);
  const ok = await send('secret-token');
  assert.equal(ok.status, 200);
  assert.equal(refreshes, 1);
});
