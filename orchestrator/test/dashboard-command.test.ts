import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Handler } from '../src/dashboard/server.ts';
import type { ServeDashboard } from '../src/cli.ts';
import { fakeTaskwire, projectDir, runOrchestrator, task, tempDir } from './helpers.ts';

// Records what would be served, without opening a port.
function fakeServe(): { serve: ServeDashboard; served: { port: number; handler: Handler }[]; closed: () => boolean } {
  const served: { port: number; handler: Handler }[] = [];
  let closed = false;
  const serve: ServeDashboard = async (handler, port) => {
    served.push({ port, handler });
    return { url: `http://127.0.0.1:${port}`, close: async () => { closed = true; } };
  };
  return { serve, served, closed: () => closed };
}

async function stateFrom(handler: Handler): Promise<{ mode: string }> {
  const response = await handler({ method: 'GET', url: '/api/state', headers: { host: '127.0.0.1' }, body: '' });
  return JSON.parse(response.body) as { mode: string };
}

test('start serves the dashboard on port 4777 by default, paused: no agent works until play', async () => {
  const home = tempDir('home');
  writeFileSync(join(home, 'config.json'), JSON.stringify({ projects: [] }));
  const fake = fakeServe();
  const run = await runOrchestrator(['start'], { home, serve: fake.serve });
  assert.equal(run.code, 0, run.stderr);
  assert.equal(fake.served[0].port, 4777);
  assert.equal((await stateFrom(fake.served[0].handler)).mode, 'paused');
  assert.deepEqual(run.stdout.trim().split('\n').map((line) => (JSON.parse(line) as { event: string }).event), ['dashboard', 'start', 'stop']);
  assert.ok(fake.closed());
});

test('dashboardPort sets the port', async () => {
  const home = tempDir('home');
  writeFileSync(join(home, 'config.json'), JSON.stringify({ dashboardPort: 5100, projects: [] }));
  const fake = fakeServe();
  const run = await runOrchestrator(['start'], { home, serve: fake.serve });
  assert.equal(run.code, 0, run.stderr);
  assert.equal(fake.served[0].port, 5100);
  assert.deepEqual(JSON.parse(run.stdout.trim().split('\n')[0]), { event: 'dashboard', at: '2026-09-27T10:00:00.000Z', url: 'http://127.0.0.1:5100' });
});

test('a port already in use stops the command with a hint', async () => {
  const home = tempDir('home');
  writeFileSync(join(home, 'config.json'), JSON.stringify({ projects: [] }));
  const busy: ServeDashboard = async () => {
    throw Object.assign(new Error('listen EADDRINUSE: address already in use 127.0.0.1:4777'), { code: 'EADDRINUSE' });
  };
  const run = await runOrchestrator(['start'], { home, serve: busy });
  assert.equal(run.code, 3);
  assert.match(JSON.parse(run.stderr).hint, /dashboardPort/);
});

test('the page carries the token its actions need, and an action shows up at the next read', async () => {
  const home = tempDir('home');
  const project = projectDir('shop');
  writeFileSync(join(home, 'config.json'), JSON.stringify({ projects: [{ path: project }] }));
  let waiting = [task({ id: 'r1', needs: 'review', status: 'qa' })];
  const taskwire = fakeTaskwire({
    'tasks --needs any': () => waiting,
    'task get': { ...task(), comments: [] },
    'task update': () => {
      waiting = [];
      return {};
    },
  });
  const fake = fakeServe();
  await runOrchestrator(['start'], { home, serve: fake.serve, taskwire: taskwire.run });
  const { handler } = fake.served[0];
  const page = await handler({ method: 'GET', url: '/', headers: { host: '127.0.0.1' }, body: '' });
  const token = /<meta name="action-token" content="([0-9a-f]+)">/.exec(page.body)?.[1] ?? '';
  assert.equal(token.length, 48);

  const action = await handler({
    method: 'POST',
    url: '/api/action',
    headers: { host: '127.0.0.1', 'x-action-token': token },
    body: JSON.stringify({ project, task: 'r1', action: 'approve' }),
  });
  assert.equal(action.status, 200, action.body);
  const after = await handler({ method: 'GET', url: '/api/state', headers: { host: '127.0.0.1' }, body: '' });
  assert.deepEqual((JSON.parse(after.body) as { waiting: unknown[] }).waiting, []);
});
