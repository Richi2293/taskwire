import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { claudeResult, fakeCommands, fakeTaskwire, projectDir, runOrchestrator, task, tempDir } from './helpers.ts';
import type { CommandCall, FakeReply } from './helpers.ts';

function setup(projectOptions: Record<string, unknown> = { testCommand: 'npm test' }): string {
  const home = tempDir('home');
  writeFileSync(join(home, 'config.json'), JSON.stringify({ projects: [{ path: projectDir('website'), ...projectOptions }] }));
  return home;
}

function taskwireFor(afterAgent: FakeReply = { ...task({ status: 'qa' }), needs: 'review' }) {
  return fakeTaskwire({
    tasks: [task({ id: 't1', name: 'Add a discount' })],
    'task update': {},
    'task get': afterAgent,
    'comment add': { id: 'c1' },
  });
}

const isVerifier = (call: CommandCall) => call.args.includes('-p') && call.args[call.args.indexOf('-p') + 1].includes('You are verifying');
const isResume = (call: CommandCall) => call.args[0] === '--resume';

// The agent CLI: the author and its resumed session answer "done", the verifier answers with the given verdicts in turn.
function agents(verdicts: string[]) {
  let verification = 0;
  return (call: CommandCall) => {
    if (!isVerifier(call)) return claudeResult();
    const verdict = verdicts[Math.min(verification++, verdicts.length - 1)];
    return claudeResult({ session_id: `verifier-${verification}`, result: `Checked the criteria.\nVERDICT: ${verdict}` });
  };
}

// Test runs answer with the given exit codes in turn.
function testRuns(codes: number[]) {
  let index = 0;
  return () => {
    const code = codes[Math.min(index++, codes.length - 1)];
    return { code, stdout: code === 0 ? 'ok 5 tests' : 'not ok 3 - applyDiscount rounds half up' };
  };
}

function lastRun(home: string): Record<string, unknown> {
  const lines = readFileSync(join(home, 'runs.jsonl'), 'utf8').trim().split('\n');
  return JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
}

test('after the agent, the orchestrator runs the project tests in the worktree, then a separate verifier', async () => {
  const home = setup();
  const commands = fakeCommands({ claude: agents(['pass']), sh: testRuns([0]) });
  const run = await runOrchestrator(['run-once'], { home, taskwire: taskwireFor().run, commands: commands.run });
  assert.equal(run.code, 0, run.stderr);
  const [author] = commands.calls.filter((call) => call.command === 'claude');
  const tests = commands.calls.filter((call) => call.command === 'sh');
  assert.deepEqual(tests.map((call) => [call.args, call.cwd]), [[['-c', 'npm test'], author.cwd]]);
  const verifiers = commands.calls.filter(isVerifier);
  assert.equal(verifiers.length, 1);
  assert.equal(verifiers[0].cwd, author.cwd);
  assert.ok(!verifiers[0].args.includes('--resume'), 'the verifier starts a fresh session');
  assert.equal(commands.calls.filter(isResume).length, 0);
  assert.deepEqual([lastRun(home).tests, lastRun(home).verdict], ['pass', 'pass']);
  // The cost counts every agent session of the run: here the author and the verifier.
  assert.equal((lastRun(home).costUsd as number).toFixed(2), '0.84');
});

test('when the tests fail, the author gets the output once, and the tests run again', async () => {
  const home = setup();
  const commands = fakeCommands({ claude: agents(['pass']), sh: testRuns([1, 0]) });
  await runOrchestrator(['run-once'], { home, taskwire: taskwireFor().run, commands: commands.run });
  const resumes = commands.calls.filter(isResume);
  assert.equal(resumes.length, 1);
  assert.equal(resumes[0].args[1], 'session-1');
  assert.match(resumes[0].args[3], /applyDiscount rounds half up/);
  assert.equal(commands.calls.filter((call) => call.command === 'sh').length, 2);
  assert.equal(commands.calls.filter(isVerifier).length, 1);
  assert.equal(lastRun(home).tests, 'pass');
});

test('when the tests fail twice, the task waits for a person with the output, and no verifier runs', async () => {
  const home = setup();
  const taskwire = taskwireFor();
  const commands = fakeCommands({ claude: agents(['pass']), sh: testRuns([1]) });
  await runOrchestrator(['run-once'], { home, taskwire: taskwire.run, commands: commands.run });
  assert.equal(commands.calls.filter(isVerifier).length, 0);
  const lines = taskwire.calls.map((call) => call.args.join(' '));
  assert.ok(lines.includes('task update t1 --needs review'));
  const comment = taskwire.calls.find((call) => call.args[0] === 'comment')?.args.at(-1) ?? '';
  assert.match(comment, /tests still fail/);
  assert.match(comment, /applyDiscount rounds half up/);
  assert.equal(lastRun(home).tests, 'fail');
});

test('when the verifier finds a problem, the author fixes it once, then tests and verifier run again', async () => {
  const home = setup();
  const commands = fakeCommands({ claude: agents(['fail', 'manual']), sh: testRuns([0]) });
  await runOrchestrator(['run-once'], { home, taskwire: taskwireFor().run, commands: commands.run });
  const resumes = commands.calls.filter(isResume);
  assert.equal(resumes.length, 1);
  assert.match(resumes[0].args[3], /Checked the criteria/);
  assert.equal(commands.calls.filter((call) => call.command === 'sh').length, 2);
  assert.equal(commands.calls.filter(isVerifier).length, 2);
  assert.equal(lastRun(home).verdict, 'manual');
});

test('without a test command only the verifier runs', async () => {
  const home = setup({});
  const commands = fakeCommands({ claude: agents(['pass']) });
  await runOrchestrator(['run-once'], { home, taskwire: taskwireFor().run, commands: commands.run });
  assert.equal(commands.calls.filter((call) => call.command === 'sh').length, 0);
  assert.equal(commands.calls.filter(isVerifier).length, 1);
  assert.equal(lastRun(home).tests, null);
});

test('a task the agent left for a decision is not tested nor verified', async () => {
  const home = setup();
  const commands = fakeCommands({ claude: agents(['pass']), sh: testRuns([0]) });
  await runOrchestrator(['run-once'], { home, taskwire: taskwireFor({ ...task(), needs: 'decision' }).run, commands: commands.run });
  assert.equal(commands.calls.filter((call) => call.command === 'sh').length, 0);
  assert.equal(commands.calls.filter(isVerifier).length, 0);
});

test('a verifier that gives no verdict leaves the task marked for review by the orchestrator', async () => {
  const home = setup({});
  const taskwire = taskwireFor();
  const commands = fakeCommands({ claude: (call) => (isVerifier(call) ? claudeResult({ result: 'I looked around.' }) : claudeResult()) });
  await runOrchestrator(['run-once'], { home, taskwire: taskwire.run, commands: commands.run });
  const lines = taskwire.calls.map((call) => call.args.join(' '));
  assert.ok(lines.includes('task update t1 --needs review'));
  assert.match(taskwire.calls.find((call) => call.args[0] === 'comment')?.args.at(-1) ?? '', /no verdict/);
  assert.equal(lastRun(home).verdict, null);
});
