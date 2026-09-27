import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProjectEntry } from '../src/config.ts';
import type { CycleResult } from '../src/cycle.ts';
import { runLoop } from '../src/scheduler.ts';
import type { LoopDeps } from '../src/scheduler.ts';
import { fakeCommands, fakeTaskwire, runOrchestrator, tempDir } from './helpers.ts';

function writeConfig(home: string, config: Record<string, unknown>): void {
  writeFileSync(join(home, 'config.json'), JSON.stringify(config));
}

interface Harness {
  deps: LoopDeps;
  logs: Record<string, unknown>[];
  // Projects whose cycle is running now, and every start in order.
  running: Set<string>;
  started: string[];
  finish: (project: string) => void;
  maxRunning: () => number;
}

// A loop with fake cycles that last until the test finishes them, and a sleep that stops after the given ticks.
function harness(home: string, ticks: number, onTick: (tick: number, h: Harness) => void = () => {}): Harness {
  const logs: Record<string, unknown>[] = [];
  const running = new Set<string>();
  const started: string[] = [];
  const waiting = new Map<string, () => void>();
  let peak = 0;
  let tick = 0;
  const h: Harness = {
    deps: {
      home,
      runTaskwire: fakeTaskwire({ tasks: [] }).run,
      runCommand: fakeCommands().run,
      now: () => Date.UTC(2026, 8, 27, 10, 0, 0),
      log: (event) => logs.push(event),
      sleep: async () => {
        tick += 1;
        onTick(tick, h);
        // Let finished cycles settle before the next tick.
        await new Promise((resolve) => setImmediate(resolve));
      },
      stopped: () => tick >= ticks,
    },
    logs,
    running,
    started,
    finish: (project) => waiting.get(project)?.(),
    maxRunning: () => peak,
  };
  h.deps.cycle = (_deps, project: ProjectEntry) => {
    running.add(project.path);
    started.push(project.path);
    peak = Math.max(peak, running.size);
    return new Promise<CycleResult>((resolve, reject) => {
      waiting.set(project.path, () => {
        running.delete(project.path);
        if (project.path.endsWith('broken')) reject(new Error('Network error calling ClickUp'));
        else resolve({ project: project.path, task: { id: 't1', name: 'Task', needs: 'review', status: 'qa' } });
      });
    });
  };
  return h;
}

test('start runs at most maxAgents cycles at once, and never two on the same project', async () => {
  const home = tempDir('home');
  writeConfig(home, { maxAgents: 2, projects: [{ path: '/p/a' }, { path: '/p/b' }, { path: '/p/c' }] });
  const h = harness(home, 3, (tick, harnessRef) => {
    if (tick === 2) harnessRef.finish('/p/a');
    if (tick === 3) for (const p of ['/p/a', '/p/b', '/p/c']) harnessRef.finish(p);
  });
  await runLoop(h.deps);
  assert.equal(h.maxRunning(), 2);
  // The first pass starts a and b; when a finishes, the next start goes to c, whose turn it is.
  assert.deepEqual(h.started, ['/p/a', '/p/b', '/p/c']);
});

test('an error in one project is logged and the loop goes on', async () => {
  const home = tempDir('home');
  writeConfig(home, { projects: [{ path: '/p/broken' }, { path: '/p/fine' }] });
  const h = harness(home, 2, (_tick, harnessRef) => {
    harnessRef.finish('/p/broken');
    harnessRef.finish('/p/fine');
  });
  await runLoop(h.deps);
  const errors = h.logs.filter((log) => log.event === 'error');
  assert.deepEqual(errors.map((log) => log.project), ['/p/broken', '/p/broken']);
  assert.match(String(errors[0].error), /Network error/);
  assert.deepEqual(h.logs.filter((log) => log.event === 'run').map((log) => log.project), ['/p/fine', '/p/fine']);
});

test('the config is read again at each tick, so a new project joins without a restart', async () => {
  const home = tempDir('home');
  writeConfig(home, { projects: [{ path: '/p/a' }] });
  const h = harness(home, 2, (tick, harnessRef) => {
    harnessRef.finish('/p/a');
    if (tick === 1) writeConfig(home, { projects: [{ path: '/p/a' }, { path: '/p/new' }] });
    if (tick === 2) harnessRef.finish('/p/new');
  });
  await runLoop(h.deps);
  assert.ok(h.started.includes('/p/new'));
});

test('start hands the tasks of an interrupted pass to a person before the first tick', async () => {
  const home = tempDir('home');
  writeConfig(home, { projects: [] });
  writeFileSync(join(home, 'claims.json'), JSON.stringify({ t9: { project: '/p/a', name: 'Old', worktree: '/wt', startedAt: '2026-09-27T08:00:00.000Z' } }));
  const taskwire = fakeTaskwire({ 'task update': {}, 'comment add': {} });
  const h = harness(home, 1);
  h.deps.runTaskwire = taskwire.run;
  await runLoop(h.deps);
  assert.deepEqual(taskwire.calls.map((call) => call.args.slice(0, 3).join(' ')), ['task update t9', 'comment add t9']);
  assert.ok(h.logs.some((log) => log.event === 'interrupted' && log.task === 't9'));
});

test('a config broken while start runs is logged, and the loop waits for it to be fixed', async () => {
  const home = tempDir('home');
  writeFileSync(join(home, 'config.json'), '{"projects": [');
  const h = harness(home, 2, (tick) => {
    if (tick === 1) writeConfig(home, { projects: [{ path: '/p/a' }] });
  });
  h.deps.sleep = (() => {
    const sleep = h.deps.sleep;
    return async (ms: number) => {
      await sleep(ms);
      h.finish('/p/a');
      await new Promise((resolve) => setImmediate(resolve));
    };
  })();
  await runLoop(h.deps);
  assert.ok(h.logs.some((log) => log.event === 'error' && String(log.error).includes('config.json')));
  assert.deepEqual(h.started, ['/p/a']);
});

test('the start command prints one JSON event per line and stops when asked', async () => {
  const home = tempDir('home');
  writeConfig(home, { projects: [] });
  const run = await runOrchestrator(['start'], { home, stopped: () => true });
  assert.equal(run.code, 0, run.stderr);
  const events = run.stdout.trim().split('\n').map((line) => (JSON.parse(line) as { event: string }).event);
  assert.deepEqual(events, ['dashboard', 'start', 'stop']);
});
