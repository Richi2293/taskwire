import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { claudeResult, fakeCommands, fakeTaskwire, projectDir, runOrchestrator, task, tempDir } from './helpers.ts';
import type { CommandCall, FakeReply } from './helpers.ts';
import { loadConfig } from '../src/config.ts';
import { readMerges } from '../src/merges.ts';

interface Setup {
  home: string;
  project: string;
}

function setup(projectOptions: Record<string, unknown> = {}): Setup {
  const home = tempDir('home');
  const project = projectDir('website');
  writeFileSync(join(home, 'config.json'), JSON.stringify({ projects: [{ path: project, ...projectOptions }] }));
  return { home, project };
}

// The task as taskwire shows it after the agent: the agent marks it, unless a test says otherwise.
function taskwireFor(afterAgent: FakeReply = { ...task({ status: 'qa' }), needs: 'review' }) {
  return fakeTaskwire({
    tasks: [task({ id: 't1', name: 'Add a discount', url: 'https://app.clickup.com/t/t1' })],
    'task update': (args: string[]) => ({ ...task(), args }),
    'task get': afterAgent,
    'comment add': { id: 'c1' },
  });
}

function writes(calls: { args: string[] }[]): string[] {
  return calls.map((call) => call.args.join(' ')).filter((line) => !line.startsWith('tasks') && !line.startsWith('task get') && line !== 'project');
}

function claudeCalls(calls: CommandCall[]): CommandCall[] {
  return calls.filter((call) => call.command === 'claude');
}

test('run-once with no task to pick changes nothing', async () => {
  const { home } = setup();
  const taskwire = fakeTaskwire({ tasks: [task({ status: 'qa' })] });
  const commands = fakeCommands();
  const run = await runOrchestrator(['run-once'], { home, taskwire: taskwire.run, commands: commands.run });
  assert.equal(run.code, 0);
  assert.deepEqual(writes(taskwire.calls), []);
  assert.deepEqual(commands.calls, []);
  assert.deepEqual((run.json() as { task: unknown }[]).map((row) => row.task), [null]);
});

test('run-once skips a project with agents off', async () => {
  const { home } = setup({ agents: false });
  const taskwire = taskwireFor();
  const commands = fakeCommands();
  const run = await runOrchestrator(['run-once'], { home, taskwire: taskwire.run, commands: commands.run });
  assert.equal(run.code, 0);
  assert.deepEqual(run.json(), []);
  assert.deepEqual(taskwire.calls.filter((call) => call.args[0] === 'tasks' && !call.args.includes('--needs')), []);
  assert.deepEqual(claudeCalls(commands.calls), []);
});

test('run-once claims the task, runs the agent in a new worktree and records the run', async () => {
  const { home, project } = setup();
  const taskwire = taskwireFor();
  const commands = fakeCommands({ claude: () => claudeResult() });
  const run = await runOrchestrator(['run-once'], { home, taskwire: taskwire.run, commands: commands.run });
  assert.equal(run.code, 0, run.stderr);

  assert.deepEqual(writes(taskwire.calls), ['task update t1 --status in progress']);
  const worktree = join(home, 'worktrees', `website-${basename(join(project, '..'))}`, 't1');
  const git = commands.calls.filter((call) => call.command === 'git');
  assert.deepEqual(git.map((call) => call.args), [
    ['fetch', '--quiet'],
    ['rev-parse', '--verify', '--quiet', 'origin/HEAD'],
    ['worktree', 'add', '--detach', worktree, 'origin/HEAD'],
    // After the agent: the branch it left the worktree on, to find its pull request.
    ['branch', '--show-current'],
  ]);
  assert.deepEqual(git.map((call) => call.cwd), [project, project, project, worktree]);
  // .taskwire.json is often kept out of git, so the worktree gets a copy.
  assert.ok(existsSync(join(worktree, '.taskwire.json')));

  const [agent] = claudeCalls(commands.calls);
  assert.equal(agent.cwd, worktree);
  assert.equal(agent.args[0], '-p');
  assert.match(agent.args[1], /task t1 \(https:\/\/app\.clickup\.com\/t\/t1\)/);
  // stream-json keeps every step of the agent in the log, not only its final answer.
  assert.deepEqual(agent.args.slice(2), ['--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions']);

  const [record] = readFileSync(join(home, 'runs.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.deepEqual(
    { project: record.project, task: record.task, name: record.name, needs: record.needs, status: record.status, costUsd: record.costUsd, durationMs: record.durationMs },
    // The cost adds up the author's session and the verifier's.
    { project, task: 't1', name: 'Add a discount', needs: 'review', status: 'qa', costUsd: 0.84, durationMs: 90_000 },
  );
  assert.equal(record.startedAt, '2026-09-27T10:00:00.000Z');
  assert.ok(existsSync(record.log as string));
  assert.deepEqual(JSON.parse(readFileSync(join(home, 'claims.json'), 'utf8')), {});
});

test('when the agent stops without marking the task, it is asked once, then the orchestrator marks it for review', async () => {
  const { home } = setup();
  const taskwire = taskwireFor({ ...task({ status: 'in progress' }), needs: null });
  const commands = fakeCommands({ claude: () => claudeResult() });
  const run = await runOrchestrator(['run-once'], { home, taskwire: taskwire.run, commands: commands.run });
  assert.equal(run.code, 0, run.stderr);

  const agents = claudeCalls(commands.calls);
  assert.equal(agents.length, 2);
  assert.deepEqual(agents[1].args.slice(0, 2), ['--resume', 'session-1']);
  assert.match(agents[1].args[3], /taskwire task update t1 --needs/);
  const lines = writes(taskwire.calls);
  assert.equal(lines[1], 'task update t1 --needs review');
  assert.match(lines[2], /^comment add t1 --text /);
});

test('when the agent run fails, the task is marked for review with the reason and the log', async () => {
  const { home } = setup();
  const taskwire = taskwireFor({ ...task({ status: 'in progress' }), needs: null });
  const commands = fakeCommands({ claude: () => ({ code: 1, stdout: '', stderr: 'Credit balance is too low' }) });
  const run = await runOrchestrator(['run-once'], { home, taskwire: taskwire.run, commands: commands.run });
  assert.equal(run.code, 0, run.stderr);
  assert.equal(claudeCalls(commands.calls).length, 1);
  const comment = taskwire.calls.find((call) => call.args[0] === 'comment')?.args.at(-1) ?? '';
  assert.match(comment, /Credit balance is too low/);
  assert.match(comment, /runs\.jsonl|\.log/);
});

test('a sandboxed project runs the agent in the Claude Code sandbox, with the proxy on for taskwire', async () => {
  const { home } = setup({ sandbox: true, allowedDomains: ['registry.npmjs.org'] });
  const commands = fakeCommands({ claude: () => claudeResult() });
  const run = await runOrchestrator(['run-once'], { home, taskwire: taskwireFor().run, commands: commands.run });
  assert.equal(run.code, 0, run.stderr);
  const [agent] = claudeCalls(commands.calls);
  assert.ok(!agent.args.includes('--dangerously-skip-permissions'));
  const settings = JSON.parse(agent.args[agent.args.indexOf('--settings') + 1]) as { sandbox: { enabled: boolean; network: { allowedDomains: string[] } } };
  assert.equal(settings.sandbox.enabled, true);
  assert.deepEqual(settings.sandbox.network.allowedDomains, ['api.clickup.com', 'registry.npmjs.org']);
  assert.equal(agent.env.NODE_USE_ENV_PROXY, '1');
});

test('without origin/HEAD the worktree starts from the current HEAD', async () => {
  const { home } = setup();
  const commands = fakeCommands({ claude: () => claudeResult(), 'git rev-parse': () => ({ code: 1 }) });
  await runOrchestrator(['run-once'], { home, taskwire: taskwireFor().run, commands: commands.run });
  const add = commands.calls.find((call) => call.args[0] === 'worktree');
  assert.equal(add?.args.at(-1), 'HEAD');
});

test('a claim left by an interrupted run is closed first: the task is marked for review', async () => {
  const { home, project } = setup();
  writeFileSync(join(home, 'claims.json'), JSON.stringify({ t9: { project, name: 'Old task', worktree: '/tmp/wt', startedAt: '2026-09-27T08:00:00.000Z' } }));
  const taskwire = fakeTaskwire({ tasks: [], 'task update': {}, 'comment add': {} });
  const run = await runOrchestrator(['run-once'], { home, taskwire: taskwire.run });
  assert.equal(run.code, 0, run.stderr);
  const lines = writes(taskwire.calls);
  assert.equal(lines[0], 'task update t9 --needs review');
  assert.match(lines[1], /^comment add t9 --text .*interrupted/s);
  assert.deepEqual(JSON.parse(readFileSync(join(home, 'claims.json'), 'utf8')), {});
});

test('a taskwire without the needs field is too old: run-once stops with a configuration error', async () => {
  const { home } = setup();
  const old = { id: 't1', name: 'Old', status: 'backlog', priority: null, tags: [], parent: null, url: 'u' };
  const run = await runOrchestrator(['run-once'], { home, taskwire: fakeTaskwire({ tasks: [old] }).run });
  assert.equal(run.code, 3);
  assert.match(JSON.parse(run.stderr).hint, /taskwireCommand/);
});

test('with a taskwireCommand, the agent finds that taskwire first on its PATH', async () => {
  const home = tempDir('home');
  const project = projectDir('website');
  writeFileSync(join(home, 'config.json'), JSON.stringify({ taskwireCommand: '/opt/taskwire/bin/taskwire', projects: [{ path: project }] }));
  const commands = fakeCommands({ claude: () => claudeResult() });
  const run = await runOrchestrator(['run-once'], { home, taskwire: taskwireFor().run, commands: commands.run });
  assert.equal(run.code, 0, run.stderr);
  const [agent] = claudeCalls(commands.calls);
  const bin = join(home, 'bin');
  assert.equal(agent.env.PATH?.split(':')[0], bin);
  assert.equal(readlinkSync(join(bin, 'taskwire')), '/opt/taskwire/bin/taskwire');
});

test('a task sent back to the agent continues in its existing worktree', async () => {
  const { home, project } = setup();
  const worktree = join(home, 'worktrees', `website-${basename(join(project, '..'))}`, 't1');
  mkdirSync(worktree, { recursive: true });
  const commands = fakeCommands({ claude: () => claudeResult() });
  const run = await runOrchestrator(['run-once'], { home, taskwire: taskwireFor().run, commands: commands.run });
  assert.equal(run.code, 0, run.stderr);
  assert.ok(!commands.calls.some((call) => call.args[0] === 'worktree'), 'no new worktree');
  assert.equal(claudeCalls(commands.calls)[0].cwd, worktree);
  assert.ok(existsSync(join(worktree, '.taskwire.json')));
});

test('run-once on a project with an area works only on a task of that area, and tells the agent to do only its part', async () => {
  const { home } = setup({ group: 'Shop' });
  const taskwire = fakeTaskwire({
    project: { area: 'fe' },
    // The oldest task of the area waits for an open task of another area, which only --all-areas shows.
    tasks: (args: string[]) => (args.includes('--all-areas')
      ? [
        task({ id: 'f1', name: 'Show the discount', tags: ['fe'] }),
        task({ id: 'b2', name: 'Add the coupon API', tags: ['be'], status: 'in progress' }),
        task({ id: 'b1', name: 'Add the discount API', tags: ['be'] }),
        task({ id: 'f2', name: 'Show the coupon', tags: ['fe'], blockedBy: ['b2'] }),
      ]
      : []),
    'task update': {},
    'task get': { ...task({ status: 'qa' }), needs: 'decision' },
    'comment add': { id: 'c1' },
  });
  const commands = fakeCommands({ claude: () => claudeResult() });
  const run = await runOrchestrator(['run-once'], { home, taskwire: taskwire.run, commands: commands.run });
  assert.equal(run.code, 0, run.stderr);
  assert.ok(taskwire.calls.some((call) => call.args.join(' ') === 'task update f1 --status in progress'));
  assert.ok(!taskwire.calls.some((call) => call.args.includes('b1') || call.args.includes('f2')));
  const prompt = claudeCalls(commands.calls)[0].args[claudeCalls(commands.calls)[0].args.indexOf('-p') + 1];
  assert.match(prompt, /the `fe` area of the group "Shop"/);
  assert.match(prompt, /only the `fe` part/);
});

function events(home: string): Record<string, unknown>[] {
  return readFileSync(join(home, 'events.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
}

test('a run writes its steps to the event diary, with neutral fields for each agent session', async () => {
  const { home, project } = setup({ testCommand: 'npm test' });
  const taskwire = taskwireFor();
  let sessions = 0;
  const commands = fakeCommands({ claude: () => claudeResult({ session_id: `session-${++sessions}` }) });
  const run = await runOrchestrator(['run-once'], { home, taskwire: taskwire.run, commands: commands.run });
  assert.equal(run.code, 0, run.stderr);

  const diary = events(home).map(({ at, ...rest }) => {
    assert.equal(at, '2026-09-27T10:00:00.000Z');
    return rest;
  });
  assert.deepEqual(diary, [
    { event: 'claim', project, task: 't1', name: 'Add a discount' },
    { event: 'agent', project, task: 't1', role: 'author', agent: 'claude', sessionId: 'session-1', ok: true, costUsd: 0.42, durationMs: 90_000 },
    { event: 'tests', project, task: 't1', command: 'npm test', result: 'pass', exitCode: 0 },
    { event: 'agent', project, task: 't1', role: 'verifier', agent: 'claude', sessionId: 'session-2', ok: true, costUsd: 0.42, durationMs: 90_000 },
  ]);

  const [record] = readFileSync(join(home, 'runs.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { sessions: unknown[]; log: string });
  assert.deepEqual(record.sessions, [
    { role: 'author', agent: 'claude', sessionId: 'session-1', ok: true, costUsd: 0.42, durationMs: 90_000 },
    { role: 'verifier', agent: 'claude', sessionId: 'session-2', ok: true, costUsd: 0.42, durationMs: 90_000 },
  ]);
  // The log keeps the whole output of each session, under a heading with its role.
  const log = readFileSync(record.log, 'utf8');
  assert.match(log, /=== author: claude, session session-1 ===\n\{"type":"result"/);
  assert.match(log, /=== verifier: claude, session session-2 ===/);
});

test('when the orchestrator marks a task for review itself, the diary says why', async () => {
  const { home } = setup();
  const taskwire = taskwireFor({ ...task({ status: 'in progress' }), needs: null });
  const commands = fakeCommands({ claude: () => claudeResult() });
  await runOrchestrator(['run-once'], { home, taskwire: taskwire.run, commands: commands.run });
  const marked = events(home).filter((event) => event.event === 'marked');
  assert.deepEqual(marked.map((event) => [event.task, event.needs, event.reason]), [['t1', 'review', 'the agent stopped without marking the task.']]);
  assert.deepEqual(events(home).filter((event) => event.event === 'agent').map((event) => event.role), ['author', 'nudge']);
});

test('the result of the agent is read from the last line of its stream', async () => {
  const { home } = setup();
  const taskwire = taskwireFor();
  const stream = [
    JSON.stringify({ type: 'system', subtype: 'init', session_id: 'session-9' }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Working.' }] }, session_id: 'session-9' }),
    'not json at all',
    JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Done.\nVERDICT: pass', session_id: 'session-9', total_cost_usd: 1.5, duration_ms: 1000 }),
  ].join('\n');
  const commands = fakeCommands({ claude: () => ({ stdout: `${stream}\n` }) });
  const run = await runOrchestrator(['run-once'], { home, taskwire: taskwire.run, commands: commands.run });
  assert.equal(run.code, 0, run.stderr);
  const [record] = readFileSync(join(home, 'runs.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { summary: string; costUsd: number; verdict: string });
  assert.equal(record.costUsd, 3);
  assert.equal(record.verdict, 'pass');
  assert.match(record.summary, /^Done\./);
});

// The git commands of an agent that left the worktree on a branch, at commit abc123, with nothing uncommitted.
const onBranch = {
  'git branch': () => ({ stdout: 'feat/discount\n' }),
  'git rev-parse': (call: CommandCall) => (call.args[1] === 'HEAD' ? { stdout: 'abc123\n' } : {}),
  'git status': () => ({ stdout: '' }),
};

// The commands of a run where the agent leaves the worktree on a branch with a pull request.
function withPullRequest(pr: Record<string, unknown>, extra: Record<string, (call: CommandCall) => Partial<{ code: number; stdout: string; stderr: string }>> = {}) {
  return fakeCommands({
    claude: () => claudeResult(),
    ...onBranch,
    'gh pr': () => ({ stdout: JSON.stringify({ number: 12, url: 'https://github.com/acme/shop/pull/12', state: 'OPEN', baseRefName: 'dev', headRefName: 'feat/discount', headRefOid: 'abc123', mergedAt: null, mergeable: 'MERGEABLE', statusCheckRollup: [], ...pr }) }),
    ...extra,
  });
}

test('with a merge level, a verified task is queued for the orchestrator to merge', async () => {
  const { home, project } = setup({ merge: 'dev' });
  const commands = withPullRequest({});
  const run = await runOrchestrator(['run-once'], { home, taskwire: taskwireFor().run, commands: commands.run });
  assert.equal(run.code, 0);
  assert.deepEqual(readMerges(home).map((entry) => [entry.project, entry.task, entry.pr, entry.branch, entry.sha]), [[project, 't1', 12, 'feat/discount', 'abc123']]);
  const events = readFileSync(join(home, 'events.jsonl'), 'utf8');
  assert.match(events, /"event":"merge-queued"/);
});

test('without a merge level nothing is queued, and the run records the branch and its pull request', async () => {
  const { home } = setup();
  const commands = withPullRequest({});
  await runOrchestrator(['run-once'], { home, taskwire: taskwireFor().run, commands: commands.run });
  assert.deepEqual(readMerges(home), []);
  const record = JSON.parse(readFileSync(join(home, 'runs.jsonl'), 'utf8').trim()) as { branch: string; pr: number };
  assert.equal(record.branch, 'feat/discount');
  assert.equal(record.pr, 12);
  assert.equal((record as { sha?: string }).sha, 'abc123');
});

test('a task the verifier left for a test by hand is not queued', async () => {
  const { home } = setup({ merge: 'dev' });
  const commands = fakeCommands({
    claude: () => claudeResult({ result: 'Checked what I could.\nVERDICT: manual' }),
    'git branch': () => ({ stdout: 'feat/discount\n' }),
    'gh pr': () => ({ stdout: JSON.stringify({ number: 12, url: 'u', state: 'OPEN', baseRefName: 'dev', headRefName: 'feat/discount', mergeable: 'MERGEABLE', statusCheckRollup: [] }) }),
  });
  await runOrchestrator(['run-once'], { home, taskwire: taskwireFor({ ...task({ status: 'qa' }), needs: 'test' }).run, commands: commands.run });
  assert.deepEqual(readMerges(home), []);
});

test('a pull request to the wrong branch goes to the person with the reason', async () => {
  const { home } = setup({ merge: 'dev' });
  const taskwire = taskwireFor();
  await runOrchestrator(['run-once'], { home, taskwire: taskwire.run, commands: withPullRequest({ baseRefName: 'main' }).run });
  assert.deepEqual(readMerges(home), []);
  assert.ok(writes(taskwire.calls).some((line) => line.startsWith('comment add t1') && line.includes('targets main, not dev')));
});

test('a pull request whose head is not the verified commit, or a worktree with uncommitted changes, goes to the person', async () => {
  const cases: [Record<string, unknown>, Record<string, () => Partial<{ stdout: string }>>, string][] = [
    [{ headRefOid: 'old999' }, {}, 'not the verified commit'],
    [{}, { 'git status': () => ({ stdout: ' M src/cart.ts\n' }) }, 'uncommitted changes'],
  ];
  for (const [pr, extra, reason] of cases) {
    const { home } = setup({ merge: 'dev' });
    const taskwire = taskwireFor();
    await runOrchestrator(['run-once'], { home, taskwire: taskwire.run, commands: withPullRequest(pr, extra).run });
    assert.deepEqual(readMerges(home), [], reason);
    assert.ok(writes(taskwire.calls).some((line) => line.startsWith('comment add t1') && line.includes(reason)), reason);
  }
});

test('a pull request merged before the run, by a person, is no alarm', async () => {
  const { home, project } = setup();
  const taskwire = taskwireFor();
  await runOrchestrator(['run-once'], { home, taskwire: taskwire.run, commands: withPullRequest({ state: 'MERGED', mergedAt: '2026-09-20T09:00:00Z' }).run });
  assert.equal(loadConfig(home).projects.find((entry) => entry.path === project)?.agents, undefined);
  assert.equal(writes(taskwire.calls).some((line) => line.includes('agents are now off')), false);
});

test('an agent that merged its own pull request and then failed still turns the agents off', async () => {
  const { home, project } = setup();
  const taskwire = taskwireFor({ ...task({ status: 'in progress' }), needs: null });
  const commands = withPullRequest({ state: 'MERGED', mergedAt: '2026-09-27T10:00:30Z' }, { claude: () => ({ code: 1, stdout: '', stderr: 'Credit balance is too low' }) });
  await runOrchestrator(['run-once'], { home, taskwire: taskwire.run, commands: commands.run });
  assert.equal(loadConfig(home).projects.find((entry) => entry.path === project)?.agents, false);
  assert.ok(writes(taskwire.calls).some((line) => line.startsWith('comment add t1') && line.includes('agents are now off')));
});

test('an agent that merged its own pull request turns the agents of the project off', async () => {
  const { home, project } = setup();
  const taskwire = taskwireFor();
  await runOrchestrator(['run-once'], { home, taskwire: taskwire.run, commands: withPullRequest({ state: 'MERGED', mergedAt: '2026-09-27T10:00:30Z' }).run });
  assert.equal(loadConfig(home).projects.find((entry) => entry.path === project)?.agents, false);
  assert.ok(writes(taskwire.calls).some((line) => line.startsWith('comment add t1') && line.includes('agents are now off')));
  assert.match(readFileSync(join(home, 'events.jsonl'), 'utf8'), /"event":"agent-merged"/);
});

test('a detached worktree or a gh that fails never breaks the pass', async () => {
  const { home } = setup({ merge: 'dev' });
  const detached = fakeCommands({ claude: () => claudeResult() });
  const first = await runOrchestrator(['run-once'], { home, taskwire: taskwireFor().run, commands: detached.run });
  assert.equal(first.code, 0);
  assert.deepEqual(detached.calls.filter((call) => call.command === 'gh'), []);
  const noGh = fakeCommands({ claude: () => claudeResult(), 'git branch': () => ({ stdout: 'feat/discount\n' }), gh: () => ({ code: 127, stderr: 'spawn gh ENOENT' }) });
  const second = await runOrchestrator(['run-once'], { home, taskwire: taskwireFor().run, commands: noGh.run });
  assert.equal(second.code, 0);
  assert.deepEqual(readMerges(home), []);
});

test('with a merge level the agent is told to open a pull request to the staging branch', async () => {
  const { home } = setup({ merge: 'dev', stagingBranch: 'develop' });
  const commands = fakeCommands({ claude: () => claudeResult() });
  await runOrchestrator(['run-once'], { home, taskwire: taskwireFor().run, commands: commands.run });
  const prompt = claudeCalls(commands.calls)[0].args.join(' ');
  assert.match(prompt, /open a pull request to `develop`/);
  assert.match(prompt, /the orchestrator merges it/);
});
