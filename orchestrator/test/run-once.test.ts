import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { claudeResult, fakeCommands, fakeTaskwire, projectDir, runOrchestrator, task, tempDir } from './helpers.ts';
import type { CommandCall, FakeReply } from './helpers.ts';

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
  return calls.map((call) => call.args.join(' ')).filter((line) => !line.startsWith('tasks') && !line.startsWith('task get'));
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
  ]);
  assert.ok(git.every((call) => call.cwd === project));
  // .taskwire.json is often kept out of git, so the worktree gets a copy.
  assert.ok(existsSync(join(worktree, '.taskwire.json')));

  const [agent] = claudeCalls(commands.calls);
  assert.equal(agent.cwd, worktree);
  assert.equal(agent.args[0], '-p');
  assert.match(agent.args[1], /task t1 \(https:\/\/app\.clickup\.com\/t\/t1\)/);
  assert.deepEqual(agent.args.slice(2), ['--output-format', 'json', '--dangerously-skip-permissions']);

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
