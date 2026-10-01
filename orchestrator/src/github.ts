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
  // The last commit of the pull request: the orchestrator merges it only when it is the verified one.
  headRefOid: string;
  // When it was merged, null while it is not.
  mergedAt: string | null;
  // The commit the merge made, null while it is not merged.
  mergeCommit: string | null;
  createdAt: string;
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  checks: ChecksState;
}

const PR_FIELDS = 'number,url,state,baseRefName,headRefName,headRefOid,mergedAt,mergeCommit,createdAt,mergeable,statusCheckRollup';
const PASSED = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
const FAILED = new Set(['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR']);

// The branch the agent left the worktree on; null on a detached HEAD, where no pull request can exist.
export async function currentBranch(run: RunCommand, worktree: string): Promise<string | null> {
  const result = await run('git', ['branch', '--show-current'], { cwd: worktree });
  const branch = result.code === 0 ? result.stdout.trim() : '';
  return branch === '' ? null : branch;
}

// The commit the worktree is at; null when git cannot tell.
export async function headCommit(run: RunCommand, worktree: string): Promise<string | null> {
  const result = await run('git', ['rev-parse', 'HEAD'], { cwd: worktree });
  const sha = result.code === 0 ? result.stdout.trim() : '';
  return sha === '' ? null : sha;
}

// Whether the worktree has changes that are not committed: then the tests and the verifier did not check what is committed.
export async function hasUncommittedChanges(run: RunCommand, worktree: string): Promise<boolean> {
  const result = await run('git', ['status', '--porcelain'], { cwd: worktree });
  return result.code !== 0 || result.stdout.trim() !== '';
}

// The pull request of a branch, or null when the branch has none.
export async function findPullRequest(run: RunCommand, cwd: string, branch: string): Promise<PullRequest | null> {
  const result = await run('gh', ['pr', 'view', branch, '--json', PR_FIELDS], { cwd });
  if (result.code !== 0) {
    if (/no pull requests? found/i.test(result.stderr)) return null;
    throw new OrchestratorError(`gh pr view failed: ${result.stderr.trim() || `exit ${result.code}`}`, EXIT.external);
  }
  return toPullRequest(parseJson(result.stdout, 'gh pr view'));
}

// The open pull request from head to base, such as the release from dev to main; null when there is none.
export async function findReleasePullRequest(run: RunCommand, cwd: string, base: string, head: string): Promise<PullRequest | null> {
  const result = await run('gh', ['pr', 'list', '--base', base, '--head', head, '--state', 'open', '--json', PR_FIELDS, '--limit', '1'], { cwd });
  if (result.code !== 0) throw new OrchestratorError(`gh pr list failed: ${result.stderr.trim() || `exit ${result.code}`}`, EXIT.external);
  const list = parseJson(result.stdout, 'gh pr list');
  return Array.isArray(list) && list.length > 0 ? toPullRequest(list[0]) : null;
}

export async function openReleasePullRequest(run: RunCommand, cwd: string, base: string, head: string): Promise<void> {
  const body = `Release of ${head} to ${base} by the taskwire orchestrator.`;
  const result = await run('gh', ['pr', 'create', '--base', base, '--head', head, '--title', `release: ${head} to ${base}`, '--body', body], { cwd });
  if (result.code !== 0) throw new OrchestratorError(`gh pr create failed: ${result.stderr.trim() || `exit ${result.code}`}`, EXIT.external);
}

// Brings the remote branches up to date; false when the remote cannot be reached.
export async function fetchRemote(run: RunCommand, cwd: string): Promise<boolean> {
  return (await run('git', ['fetch', '--quiet'], { cwd })).code === 0;
}

// The commit a remote branch is at, as of the last fetch; null when the branch is unknown.
export async function remoteCommit(run: RunCommand, cwd: string, branch: string): Promise<string | null> {
  const result = await run('git', ['rev-parse', '--verify', '--quiet', `origin/${branch}`], { cwd });
  const sha = result.code === 0 ? result.stdout.trim() : '';
  return sha === '' ? null : sha;
}

// How many commits head has that base has not, between remote branches; 0 when git cannot tell.
export async function aheadBy(run: RunCommand, cwd: string, base: string, head: string): Promise<number> {
  const result = await run('git', ['rev-list', '--count', `origin/${base}..origin/${head}`], { cwd });
  const count = Number(result.stdout.trim());
  return result.code === 0 && Number.isInteger(count) ? count : 0;
}

// Whether a commit is in a remote branch, as of the last fetch.
export async function isInBranch(run: RunCommand, cwd: string, sha: string, branch: string): Promise<boolean> {
  return (await run('git', ['merge-base', '--is-ancestor', sha, `origin/${branch}`], { cwd })).code === 0;
}

function parseJson(stdout: string, what: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new OrchestratorError(`${what} did not print JSON`, EXIT.external);
  }
}

function toPullRequest(value: unknown): PullRequest {
  const data = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  return {
    number: Number(data.number),
    url: String(data.url ?? ''),
    state: data.state === 'MERGED' || data.state === 'CLOSED' ? data.state : 'OPEN',
    baseRefName: String(data.baseRefName ?? ''),
    headRefName: String(data.headRefName ?? ''),
    headRefOid: String(data.headRefOid ?? ''),
    mergedAt: typeof data.mergedAt === 'string' ? data.mergedAt : null,
    mergeCommit: mergeCommitOf(data.mergeCommit),
    createdAt: String(data.createdAt ?? ''),
    mergeable: data.mergeable === 'MERGEABLE' || data.mergeable === 'CONFLICTING' ? data.mergeable : 'UNKNOWN',
    checks: checksState(data.statusCheckRollup),
  };
}

function mergeCommitOf(value: unknown): string | null {
  const oid = typeof value === 'object' && value !== null ? (value as { oid?: unknown }).oid : undefined;
  return typeof oid === 'string' && oid !== '' ? oid : null;
}

// The default branch of the remote, such as main; null when git cannot tell.
export async function defaultBranch(run: RunCommand, cwd: string): Promise<string | null> {
  const result = await run('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd });
  const ref = result.code === 0 ? result.stdout.trim() : '';
  return ref === '' ? null : ref.replace(/^origin\//, '');
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

// The only merges the orchestrator makes: a squash of a task into staging, a merge commit for a release, like the project workflow.
// GitHub refuses it if the pull request moved on from the checked commit in the meantime.
export async function mergePullRequest(run: RunCommand, cwd: string, pr: number, sha: string, method: 'squash' | 'merge' = 'squash'): Promise<void> {
  const result = await run('gh', ['pr', 'merge', String(pr), `--${method}`, '--match-head-commit', sha], { cwd });
  if (result.code !== 0) throw new OrchestratorError(`gh pr merge failed: ${result.stderr.trim() || `exit ${result.code}`}`, EXIT.external);
}
