import { runClaude } from './agent.ts';
import type { AgentOptions, AgentResult } from './agent.ts';
import type { RunCommand } from './commands.ts';
import { fixFindingsPrompt, fixTestsPrompt, verifyPrompt } from './prompts.ts';
import type { TaskSummary } from './taskwire.ts';

export type Verdict = 'pass' | 'manual' | 'fail';

export interface Verification {
  tests: 'pass' | 'fail' | null;
  verdict: Verdict | null;
  // Why a person must look at the task, when the verification could not end well; null otherwise.
  problem: string | null;
  outputs: string[];
  // What the agent sessions of the verification cost, null when none reported a cost.
  costUsd: number | null;
}

export interface VerifyRequest {
  task: TaskSummary;
  worktree: string;
  testCommand: string | undefined;
  // The author's session, resumed to send it failing tests or the verifier's findings.
  authorSession: string | null;
  agentOptions: AgentOptions;
}

// Output kept for comments and prompts: the end of a test run is where the failures are.
const OUTPUT_TAIL = 3000;

// Checks the author's work without trusting it: the project tests, then a separate verifier agent.
// The author gets one chance to fix what fails; after that a person decides.
export async function verifyWork(run: RunCommand, request: VerifyRequest): Promise<Verification> {
  const outputs: string[] = [];
  let costUsd: number | null = null;
  const track = (result: AgentResult): void => {
    outputs.push(result.output);
    costUsd = addCost(costUsd, result.costUsd);
  };
  const resumeAuthor = async (prompt: string): Promise<void> => {
    if (request.authorSession === null) return;
    track(await runClaude(run, { prompt, cwd: request.worktree, resume: request.authorSession }, request.agentOptions));
  };
  const testsPass = async (): Promise<{ tests: 'pass' | 'fail' | null; output: string }> => {
    if (request.testCommand === undefined) return { tests: null, output: '' };
    const result = await run('sh', ['-c', request.testCommand], { cwd: request.worktree });
    const output = `${result.stdout}${result.stderr}`.slice(-OUTPUT_TAIL);
    outputs.push(`[tests: ${request.testCommand}, exit ${result.code}]\n${output}`);
    return { tests: result.code === 0 ? 'pass' : 'fail', output };
  };
  const verify = async (): Promise<{ verdict: Verdict | null; findings: string }> => {
    const result = await runClaude(run, { prompt: verifyPrompt(request.task), cwd: request.worktree }, request.agentOptions);
    track(result);
    return { verdict: parseVerdict(result.summary), findings: result.summary };
  };
  const testsFailed = (output: string): Verification => ({
    tests: 'fail',
    verdict: null,
    problem: `the project tests still fail after one fix (\`${request.testCommand}\`):\n\n\`\`\`\n${output.trim()}\n\`\`\``,
    outputs,
    costUsd,
  });

  let tests = await testsPass();
  if (tests.tests === 'fail') {
    await resumeAuthor(fixTestsPrompt(request.task, request.testCommand ?? '', tests.output));
    tests = await testsPass();
    if (tests.tests === 'fail') return testsFailed(tests.output);
  }

  let check = await verify();
  if (check.verdict === 'fail') {
    await resumeAuthor(fixFindingsPrompt(request.task, check.findings));
    tests = await testsPass();
    if (tests.tests === 'fail') return testsFailed(tests.output);
    check = await verify();
  }

  let problem: string | null = null;
  if (check.verdict === null) problem = 'the verifier gave no verdict';
  else if (check.verdict === 'fail') problem = `the verifier still finds problems after one fix: ${check.findings}`;
  return { tests: tests.tests, verdict: check.verdict, problem, outputs, costUsd };
}

// The verifier ends its answer with a line "VERDICT: pass", "VERDICT: manual" or "VERDICT: fail".
export function parseVerdict(text: string): Verdict | null {
  const matches = [...text.matchAll(/^VERDICT:\s*(pass|manual|fail)\s*$/gim)];
  const last = matches.at(-1)?.[1]?.toLowerCase();
  return last === 'pass' || last === 'manual' || last === 'fail' ? last : null;
}

export function addCost(total: number | null, cost: number | null): number | null {
  return cost === null ? total : (total ?? 0) + cost;
}
