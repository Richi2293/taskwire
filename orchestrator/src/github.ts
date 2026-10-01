import type { RunCommand } from './commands.ts';
import { EXIT, OrchestratorError } from './errors.ts';

export type ChecksState = 'pass' | 'pending' | 'fail' | 'none';

// What the orchestrator needs to know about the pull request of a task.
export interface PullRequest {
  number: number;
  url: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  baseRefName: string;
  headRefName: string;
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  checks: ChecksState;
}

const PR_FIELDS = 'number,url,state,baseRefName,headRefName,mergeable,statusCheckRollup';
const PASSED = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
const FAILED = new Set(['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR']);

// The branch the agent left the worktree on; null on a detached HEAD, where no pull request can exist.
export async function currentBranch(run: RunCommand, worktree: string): Promise<string | null> {
  const result = await run('git', ['branch', '--show-current'], { cwd: worktree });
  const branch = result.code === 0 ? result.stdout.trim() : '';
  return branch === '' ? null : branch;
}

// The pull request of a branch, or null when the branch has none.
export async function findPullRequest(run: RunCommand, cwd: string, branch: string): Promise<PullRequest | null> {
  const result = await run('gh', ['pr', 'view', branch, '--json', PR_FIELDS], { cwd });
  if (result.code !== 0) {
    if (/no pull requests? found/i.test(result.stderr)) return null;
    throw new OrchestratorError(`gh pr view failed: ${result.stderr.trim() || `exit ${result.code}`}`, EXIT.external);
  }
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(result.stdout) as Record<string, unknown>;
  } catch {
    throw new OrchestratorError('gh pr view did not print JSON', EXIT.external);
  }
  return {
    number: Number(data.number),
    url: String(data.url ?? ''),
    state: data.state === 'MERGED' || data.state === 'CLOSED' ? data.state : 'OPEN',
    baseRefName: String(data.baseRefName ?? ''),
    headRefName: String(data.headRefName ?? ''),
    mergeable: data.mergeable === 'MERGEABLE' || data.mergeable === 'CONFLICTING' ? data.mergeable : 'UNKNOWN',
    checks: checksState(data.statusCheckRollup),
  };
}

// The checks of a pull request as one state: GitHub Actions report check runs, other CI tools report status contexts.
// A status context still PENDING or EXPECTED is neither passed nor failed, so it counts as pending.
export function checksState(rollup: unknown): ChecksState {
  if (!Array.isArray(rollup) || rollup.length === 0) return 'none';
  let pending = false;
  for (const entry of rollup) {
    const check = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
    const outcome = String(check.__typename === 'StatusContext' ? check.state : check.status === 'COMPLETED' ? check.conclusion : '');
    if (FAILED.has(outcome)) return 'fail';
    if (!PASSED.has(outcome)) pending = true;
  }
  return pending ? 'pending' : 'pass';
}

// The only merge the orchestrator makes into staging: a squash, like the project workflow.
export async function mergePullRequest(run: RunCommand, cwd: string, pr: number): Promise<void> {
  const result = await run('gh', ['pr', 'merge', String(pr), '--squash'], { cwd });
  if (result.code !== 0) throw new OrchestratorError(`gh pr merge failed: ${result.stderr.trim() || `exit ${result.code}`}`, EXIT.external);
}
