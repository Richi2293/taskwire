import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createStore } from '../src/dashboard/snapshot.ts';
import type { StoreDeps } from '../src/dashboard/snapshot.ts';

// Reads every project, then returns the state the page would get.
function reader(deps: StoreDeps) {
  const store = createStore(deps);
  return async () => {
    await store.refresh();
    return store.state();
  };
}
import { projectDir, task, tempDir } from './helpers.ts';

const NOW = new Date(2026, 8, 27, 18, 21, 0).getTime();

function setup() {
  const home = tempDir('home');
  const shop = projectDir('shop');
  const website = projectDir('website');
  writeFileSync(join(home, 'config.json'), JSON.stringify({ intervalMinutes: 10, maxAgents: 3, projects: [{ path: shop }, { path: website }] }));
  writeFileSync(join(home, 'claims.json'), JSON.stringify({ w1: { project: website, name: 'Sum the cart', worktree: '/wt', startedAt: new Date(NOW - 12 * 60_000).toISOString() } }));
  const run = (id: string, finishedAt: number) => JSON.stringify({ project: website, task: id, name: id, url: 'u', startedAt: new Date(finishedAt).toISOString(), finishedAt: new Date(finishedAt).toISOString(), durationMs: 1, costUsd: 0.4, needs: 'review', status: 'qa', summary: '', tests: 'pass', verdict: 'pass', worktree: '/wt', log: '/l' });
  writeFileSync(join(home, 'runs.jsonl'), `${run('yesterday', NOW - 26 * 3600_000)}\n${run('today', NOW - 3600_000)}\n`);
  const tasks: Record<string, unknown[]> = {
    [shop]: [task({ id: 'next', name: 'Retry the update check', status: 'backlog' }), task({ id: 'd1', name: 'Show prices in the customer currency', needs: 'decision' })],
    [website]: [task({ id: 'r1', name: 'Show the total', needs: 'review', status: 'qa' })],
  };
  const calls: string[] = [];
  const runTaskwire = async (args: string[], cwd: string) => {
    calls.push(`${cwd.split('/').pop()} ${args.join(' ')}`);
    if (args[0] === 'tasks') return args.includes('--needs') ? tasks[cwd].filter((t) => (t as { needs: unknown }).needs !== null) : tasks[cwd];
    return {
      ...task(),
      description: '> **Obiettivo:** mostrare i prezzi nella valuta del cliente.\n> **Perché:** alcuni clienti non pagano in euro.',
      comments: [{ id: 'c1', author: 'jane', date: new Date(NOW - 2 * 3600_000).toISOString(), text: '> **Stato:** servono decisioni.\n\n---\n\n### Questions\n\n1. Conversion or symbol only?\n\n### Proposal\n\nSymbol only.' }],
    };
  };
  return { home, shop, website, calls, snapshot: reader({ home, runTaskwire, now: () => NOW, working: () => true, nextCheckAt: () => NOW + 3 * 60_000 }) };
}

test('the control part says the mode, the timing, the capacity and the task that would start first', async () => {
  const { snapshot, shop, website } = setup();
  const { control } = await snapshot();
  assert.deepEqual(control, {
    mode: 'working',
    intervalMinutes: 10,
    maxAgents: 3,
    agentsAtWork: 1,
    nextCheckAt: new Date(NOW + 3 * 60_000).toISOString(),
    busyProjects: ['website'],
    firstTask: { project: shop, projectName: 'shop', id: 'next', name: 'Retry the update check', status: 'backlog' },
  });
  assert.ok(website);
});

test('each project says what waits for the person, which agent works and how many tasks ended today', async () => {
  const { snapshot } = setup();
  const { projects } = await snapshot();
  assert.deepEqual(projects.map((p) => [p.projectName, p.waiting, p.working?.name ?? null, p.doneToday, p.error]), [
    ['shop', { decision: 1, test: 0, review: 0 }, null, 0, null],
    ['website', { decision: 0, test: 0, review: 1 }, 'Sum the cart', 1, null],
  ]);
});

test('a project with agents off still shows what waits for the person, but its tasks do not start first', async () => {
  const { snapshot, home, shop, website } = setup();
  writeFileSync(join(home, 'config.json'), JSON.stringify({ projects: [{ path: shop, agents: false }, { path: website }] }));
  const state = await snapshot();
  assert.deepEqual(state.projects.map((p) => [p.projectName, p.agents]), [['shop', false], ['website', true]]);
  assert.deepEqual(state.waiting.map((item) => item.id), ['d1', 'r1']);
  assert.equal(state.control.firstTask, null);
});

test('a waiting task carries its goal, how long it has waited and the sections of its last comment', async () => {
  const { snapshot } = setup();
  const { waiting } = await snapshot();
  const decision = waiting.find((item) => item.id === 'd1');
  assert.equal(decision?.goal, 'mostrare i prezzi nella valuta del cliente.');
  assert.equal(decision?.since, new Date(NOW - 2 * 3600_000).toISOString());
  assert.deepEqual(decision?.questions, ['Conversion or symbol only?']);
  assert.equal(decision?.proposal, 'Symbol only.');
  assert.deepEqual(decision?.note, ['Stato: servono decisioni.']);
});

test('a project that cannot be read shows its error in its own row', async () => {
  const home = tempDir('home');
  const broken = projectDir('broken');
  writeFileSync(join(home, 'config.json'), JSON.stringify({ projects: [{ path: broken }] }));
  const snapshot = reader({ home, runTaskwire: async () => { throw new Error('No ClickUp token found'); }, now: () => NOW });
  const state = await snapshot();
  assert.equal(state.projects[0].error, 'No ClickUp token found');
  assert.equal(state.control.firstTask, null);
});

test('each project tells its last analysis, and whether one is due before its next task', async () => {
  const { snapshot, home, shop, website } = setup();
  const analysis = { project: website, startedAt: new Date(NOW - 20 * 60_000).toISOString(), finishedAt: new Date(NOW - 15 * 60_000).toISOString(), ok: true, summary: 'Due task vaghi segnati.', costUsd: 0.5, durationMs: 1, log: '/l' };
  writeFileSync(join(home, 'analyses.jsonl'), `${JSON.stringify(analysis)}\n`);
  const { projects } = await snapshot();
  assert.deepEqual(projects.map((p) => [p.projectName, p.analysis, p.analysisDue]), [
    ['shop', null, true],
    ['website', { at: analysis.finishedAt, ok: true, summary: 'Due task vaghi segnati.' }, false],
  ]);
  assert.ok(shop);
});

test('an analysis at work shows as the agent at work on its project', async () => {
  const { snapshot, home, shop } = setup();
  writeFileSync(join(home, 'claims.json'), JSON.stringify({ [`analysis:${shop}`]: { project: shop, name: 'Project analysis', worktree: '/wt', startedAt: new Date(NOW - 60_000).toISOString(), kind: 'analysis' } }));
  const { projects, control } = await snapshot();
  assert.equal(projects[0].working?.name, 'Project analysis');
  assert.equal(projects[0].working?.kind, 'analysis');
  assert.equal(control.agentsAtWork, 1);
});

test('a waiting task carries why the analysis proposed it and why it is ready to close', async () => {
  const home = tempDir('home');
  const shop = projectDir('shop');
  writeFileSync(join(home, 'config.json'), JSON.stringify({ projects: [{ path: shop }] }));
  const comments: Record<string, string> = {
    p1: '> **Stato:** proposto.\n\n---\n\n### Proposed task\n\nMancano i test dei pagamenti.',
    c1: '> **Fatto:** verificato.\n\n---\n\n### Ready to close\n\nPR #12 mergiata.',
  };
  const runTaskwire = async (args: string[]) => {
    if (args[0] === 'tasks') return [task({ id: 'p1', needs: 'decision', tags: ['no-agent'] }), task({ id: 'c1', needs: 'review', status: 'qa' })];
    return { ...task(), description: '', comments: [{ id: 'x', author: 'jane', date: null, text: comments[args[2]] }] };
  };
  const { waiting } = await reader({ home, runTaskwire, now: () => NOW })();
  assert.deepEqual(waiting.map((item) => [item.id, item.proposedTask, item.readyToClose]), [
    ['p1', 'Mancano i test dei pagamenti.', null],
    ['c1', null, 'PR #12 mergiata.'],
  ]);
});

test('each project shows its area from taskwire and its group, and projects of a group come together', async () => {
  const { home, shop, website } = setup();
  const blog = projectDir('blog');
  writeFileSync(join(home, 'config.json'), JSON.stringify({ projects: [
    { path: website, group: 'Shop' },
    { path: blog },
    { path: shop, group: 'Shop' },
  ] }));
  const areas: Record<string, string | null> = { [website]: 'fe', [shop]: 'be', [blog]: null };
  const runTaskwire = async (args: string[], cwd: string) => (args[0] === 'project' ? { area: areas[cwd] } : []);
  const { projects } = await reader({ home, runTaskwire, now: () => NOW })();
  assert.deepEqual(projects.map((p) => [p.projectName, p.area, p.group]), [['website', 'fe', 'Shop'], ['shop', 'be', 'Shop'], ['blog', null, null]]);
});

// taskwire shows only the tasks of the area by default, so the dashboard reads every area and keeps each task in one project.
test('a project with an area shows its tasks, and the tasks with no area show once, in the first project of the group', async () => {
  const { home, shop, website } = setup();
  writeFileSync(join(home, 'config.json'), JSON.stringify({ projects: [{ path: website, group: 'Shop' }, { path: shop, group: 'Shop' }] }));
  writeFileSync(join(home, 'claims.json'), '{}');
  const areas: Record<string, string> = { [website]: 'fe', [shop]: 'be' };
  const shared = [
    task({ id: 'f1', name: 'Show the coupon', needs: 'review', status: 'qa', tags: ['fe'] }),
    task({ id: 'b1', name: 'Add the coupon API', needs: 'decision', tags: ['be'] }),
    task({ id: 'n1', name: 'Which area sends the receipts', needs: 'decision' }),
    task({ id: 'x1', name: 'Fix the date format', needs: 'test', status: 'qa', tags: ['bug'] }),
    task({ id: 'b2', name: 'Add the receipt API', tags: ['be'] }),
    task({ id: 'n2', name: 'Send the receipts' }),
  ];
  const reads: string[] = [];
  const runTaskwire = async (args: string[], cwd: string) => {
    if (args[0] === 'project') return { area: areas[cwd] };
    if (args[0] === 'tasks') {
      reads.push(args.join(' '));
      return shared;
    }
    return { ...task(), description: '', comments: [] };
  };
  const { projects, waiting, control } = await reader({ home, runTaskwire, now: () => NOW, working: () => true })();
  assert.deepEqual(reads, ['tasks --all-areas', 'tasks --all-areas']);
  assert.deepEqual(waiting.map((item) => [item.projectName, item.id]).sort(), [['shop', 'b1'], ['website', 'f1'], ['website', 'n1'], ['website', 'x1']]);
  assert.deepEqual(projects.map((p) => [p.projectName, p.waiting]), [['website', { decision: 1, test: 1, review: 1 }], ['shop', { decision: 1, test: 0, review: 0 }]]);
  // The task that would start first is one of the area: a task with no area is taken by no agent.
  assert.equal(control.firstTask?.id, 'b2');
});
