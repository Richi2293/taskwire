import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProjectEntry } from '../src/config.ts';
import type { CycleResult } from '../src/cycle.ts';
import { createRunControl } from '../src/control.ts';
import { runLoop } from '../src/scheduler.ts';
import { readClaims } from '../src/state.ts';
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
  // Projects analysed, in order.
  analysed: string[];
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
        // Let the cycles just started get past a due analysis first.
        await new Promise((resolve) => setImmediate(resolve));
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
    analysed: [],
  };
  // A fake analysis that ends at once and is recorded like a real one, so it is not due again right away.
  h.deps.analyze = async (deps, project) => {
    h.analysed.push(project.path);
    const at = new Date(deps.now()).toISOString();
    const record = { project: project.path, startedAt: at, finishedAt: at, ok: true, summary: 'Nothing to change.', costUsd: 0.1, durationMs: 1, log: '/l' };
    appendFileSync(join(home, 'analyses.jsonl'), `${JSON.stringify(record)}\n`);
    return record;
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

test('a project with agents off gets no new work, and one without the field works as before', async () => {
  const home = tempDir('home');
  writeConfig(home, { projects: [{ path: '/p/off', agents: false }, { path: '/p/on' }] });
  const h = harness(home, 2, (_tick, harnessRef) => harnessRef.finish('/p/on'));
  await runLoop(h.deps);
  assert.deepEqual(h.started, ['/p/on', '/p/on']);
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
  // The same events go to the diary, whoever started the orchestrator.
  const diary = readFileSync(join(home, 'events.jsonl'), 'utf8').trim().split('\n').map((line) => (JSON.parse(line) as { event: string }).event);
  assert.deepEqual(diary, ['dashboard', 'start', 'stop']);
});

test('with a run control, no agent starts until play, and pause stops new work', async () => {
  const home = tempDir('home');
  writeConfig(home, { projects: [{ path: '/p/a' }] });
  const control = createRunControl();
  const startedAtTick: number[] = [];
  const h = harness(home, 3, (tick, harnessRef) => {
    startedAtTick.push(harnessRef.started.length);
    if (tick === 1) control.play();
    if (tick === 2) {
      harnessRef.finish('/p/a');
      control.pause();
    }
  });
  h.deps.control = control;
  await runLoop(h.deps);
  assert.deepEqual(startedAtTick, [0, 1, 1]);
  assert.deepEqual(h.started, ['/p/a']);
});

test('the loop tells when it looks for new tasks next, and nothing while paused', async () => {
  const home = tempDir('home');
  writeConfig(home, { intervalMinutes: 5, projects: [] });
  const control = createRunControl();
  const waits: (number | null)[] = [];
  const h = harness(home, 2, (tick) => {
    if (tick === 1) control.play();
  });
  h.deps.control = control;
  h.deps.onWait = (until) => waits.push(until);
  await runLoop(h.deps);
  assert.deepEqual(waits, [null, Date.UTC(2026, 8, 27, 10, 5, 0)]);
});

test('a project is analysed before its first task, then again only once analysisHours have passed', async () => {
  const home = tempDir('home');
  writeConfig(home, { analysisHours: 1, projects: [{ path: '/p/a' }] });
  let now = Date.UTC(2026, 8, 27, 10, 0, 0);
  const h = harness(home, 3, (tick, harnessRef) => {
    harnessRef.finish('/p/a');
    if (tick === 2) now += 3600_000;
  });
  h.deps.now = () => now;
  await runLoop(h.deps);
  assert.deepEqual(h.analysed, ['/p/a', '/p/a']);
  assert.deepEqual(h.started, ['/p/a', '/p/a', '/p/a']);
  const analyses = h.logs.filter((log) => log.event === 'analysis');
  assert.deepEqual(analyses.map((log) => [log.project, log.ok, log.summary]), [['/p/a', true, 'Nothing to change.'], ['/p/a', true, 'Nothing to change.']]);
});

test('an analysis that fails is logged, and the task of the project still runs', async () => {
  const home = tempDir('home');
  writeConfig(home, { projects: [{ path: '/p/a' }] });
  const h = harness(home, 1, (_tick, harnessRef) => harnessRef.finish('/p/a'));
  h.deps.analyze = async () => {
    throw new Error('git worktree add failed');
  };
  await runLoop(h.deps);
  assert.ok(h.logs.some((log) => log.event === 'error' && log.project === '/p/a' && String(log.error).includes('git worktree')));
  assert.deepEqual(h.started, ['/p/a']);
});

test('no analysis runs while paused or on a project with agents off', async () => {
  const home = tempDir('home');
  writeConfig(home, { projects: [{ path: '/p/a' }, { path: '/p/off', agents: false }] });
  const control = createRunControl();
  const h = harness(home, 2, (tick, harnessRef) => {
    if (tick === 1) {
      assert.deepEqual(harnessRef.analysed, []);
      control.play();
    }
    if (tick === 2) harnessRef.finish('/p/a');
  });
  h.deps.control = control;
  await runLoop(h.deps);
  assert.deepEqual(h.analysed, ['/p/a']);
});

test('an analysis cut short is dropped at start, without touching any task', async () => {
  const home = tempDir('home');
  writeConfig(home, { projects: [] });
  writeFileSync(join(home, 'claims.json'), JSON.stringify({ 'analysis:/p/a': { project: '/p/a', name: 'Project analysis', worktree: '/wt', startedAt: '2026-09-27T08:00:00.000Z', kind: 'analysis' } }));
  const taskwire = fakeTaskwire({});
  const h = harness(home, 1);
  h.deps.runTaskwire = taskwire.run;
  await runLoop(h.deps);
  assert.deepEqual(taskwire.calls, []);
  assert.deepEqual(readClaims(home), {});
  assert.ok(!h.logs.some((log) => log.event === 'interrupted'));
});

test('two projects of the same group are never analysed at once, so they do not act on the same shared tasks', async () => {
  const home = tempDir('home');
  writeConfig(home, { maxAgents: 3, projects: [{ path: '/p/api', group: 'Shop' }, { path: '/p/web', group: 'Shop' }, { path: '/p/blog' }] });
  const analysedAtTick: string[][] = [];
  const h = harness(home, 2, (_tick, harnessRef) => {
    analysedAtTick.push([...harnessRef.analysed]);
    for (const p of ['/p/api', '/p/web', '/p/blog']) harnessRef.finish(p);
  });
  await runLoop(h.deps);
  // web waits for the analysis of api; blog is in no group and goes on.
  assert.deepEqual(analysedAtTick[0], ['/p/api', '/p/blog']);
  assert.deepEqual(h.analysed, ['/p/api', '/p/blog', '/p/web']);
});
