import { markForReview } from './cycle.ts';
import type { CycleDeps } from './cycle.ts';
import { DEFAULT_STAGING_BRANCH, mergeLevel } from './config.ts';
import type { ProjectEntry } from './config.ts';
import { currentBranch, findPullRequest, mergePullRequest } from './github.ts';
import type { PullRequest } from './github.ts';
import { readMerges, writeMerges } from './merges.ts';
import type { PendingMerge } from './merges.ts';
import { setProjectAgents } from './projects.ts';
import type { TaskSummary } from './taskwire.ts';
import { worktreePath } from './worktree.ts';

export interface PassOutcome {
  branch: string | null;
  pr: number | null;
  // Why the task must go to a person; null when nothing is wrong.
  problem: string | null;
}

// After an agent worked on a task: an agent that merged on its own loses the project, and a verified task is queued for the merge.
export async function afterPass(
  deps: CycleDeps,
  project: ProjectEntry,
  pass: { task: TaskSummary; worktree: string; verified: boolean },
): Promise<PassOutcome> {
  const note = (event: Record<string, unknown>): void => deps.log?.({ ...event, at: new Date(deps.now()).toISOString(), project: project.path, task: pass.task.id });
  const branch = await currentBranch(deps.runCommand, pass.worktree);
  if (branch === null) return { branch: null, pr: null, problem: null };
  let pr: PullRequest | null;
  try {
    pr = await findPullRequest(deps.runCommand, project.path, branch);
  } catch (error) {
    // Without gh the pass still ends well: the person merges, as without a merge level.
    note({ event: 'error', error: error instanceof Error ? error.message : String(error) });
    return { branch, pr: null, problem: null };
  }
  if (pr?.state === 'MERGED') {
    setProjectAgents(deps.home, project.path, false);
    note({ event: 'agent-merged', pr: pr.number });
    return { branch, pr: pr.number, problem: 'the pull request was merged during the agent run, not by the orchestrator: agents are now off for this project' };
  }
  const outcome = { branch, pr: pr?.number ?? null, problem: null };
  if (mergeLevel(project) === 'none' || !pass.verified) return outcome;
  const staging = project.stagingBranch ?? DEFAULT_STAGING_BRANCH;
  if (pr === null) return { ...outcome, problem: `no pull request found for branch ${branch}, so the orchestrator cannot merge it` };
  if (pr.state === 'CLOSED') return { ...outcome, problem: 'the pull request was closed without merging' };
  if (pr.baseRefName !== staging) {
    return { ...outcome, problem: `the pull request targets ${pr.baseRefName}, not ${staging}: the orchestrator merges only into ${staging}` };
  }
  const queue = readMerges(deps.home).filter((entry) => !(entry.project === project.path && entry.task === pass.task.id));
  queue.push({ project: project.path, task: pass.task.id, name: pass.task.name, branch, pr: pr.number, url: pr.url, queuedAt: new Date(deps.now()).toISOString() });
  writeMerges(deps.home, queue);
  note({ event: 'merge-queued', pr: pr.number, branch });
  return outcome;
}

// How long a pull request may show no CI checks before the person is told: right after it is opened GitHub has not registered them yet.
export const NO_CHECKS_GRACE_MS = 10 * 60_000;

type Decision = { kind: 'wait' } | { kind: 'skip'; reason: string } | { kind: 'hand-over'; reason: string } | { kind: 'merge'; pr: PullRequest };

// Merges the queued tasks of a project whose pull request is ready, and hands the others to the person once they cannot be merged.
// Every condition is checked again here: the task, the level or the pull request may have changed since the pass.
export async function processMerges(deps: CycleDeps, project: ProjectEntry): Promise<void> {
  const staging = project.stagingBranch ?? DEFAULT_STAGING_BRANCH;
  for (const entry of readMerges(deps.home).filter((item) => item.project === project.path)) {
    const note = (event: Record<string, unknown>): void => deps.log?.({ ...event, at: new Date(deps.now()).toISOString(), project: project.path, task: entry.task });
    const worktree = worktreePath(deps.home, project.path, entry.task);
    const decision = await decide(deps, project, entry, staging);
    if (decision.kind === 'wait') continue;
    drop(deps.home, entry);
    if (decision.kind === 'skip') {
      note({ event: 'merge-skipped', pr: entry.pr, reason: decision.reason });
    } else if (decision.kind === 'hand-over') {
      await markForReview(deps, project.path, entry.task, `${decision.reason}.`, worktree);
    } else {
      try {
        await mergePullRequest(deps.runCommand, project.path, decision.pr.number);
      } catch (error) {
        await markForReview(deps, project.path, entry.task, `the merge failed: ${error instanceof Error ? error.message : String(error)}.`, worktree);
        continue;
      }
      await deps.runTaskwire(['task', 'update', entry.task, '--needs', 'none'], project.path);
      const text = `> **Done:** merged into \`${staging}\` by the orchestrator, ${decision.pr.url}.\n> **Next:** release \`${staging}\` to production, then close the task.`;
      await deps.runTaskwire(['comment', 'add', entry.task, '--text', text], project.path);
      note({ event: 'merge', pr: decision.pr.number, branch: entry.branch, base: staging });
    }
  }
}

async function decide(deps: CycleDeps, project: ProjectEntry, entry: PendingMerge, staging: string): Promise<Decision> {
  if (mergeLevel(project) === 'none') return { kind: 'skip', reason: 'the merge level is PR only' };
  const task = (await deps.runTaskwire(['task', 'get', entry.task, '--comments', '0'], project.path)) as Partial<TaskSummary>;
  if (task.needs !== 'review') return { kind: 'skip', reason: 'the task changed since it was verified' };
  let pr: PullRequest | null;
  try {
    pr = await findPullRequest(deps.runCommand, project.path, entry.branch);
  } catch (error) {
    return { kind: 'hand-over', reason: error instanceof Error ? error.message : String(error) };
  }
  if (pr === null) return { kind: 'hand-over', reason: `the pull request of branch ${entry.branch} is gone` };
  if (pr.state === 'MERGED') return { kind: 'skip', reason: 'already merged by a person' };
  if (pr.state === 'CLOSED') return { kind: 'hand-over', reason: 'the pull request was closed without merging' };
  if (pr.baseRefName !== staging) return { kind: 'hand-over', reason: `the pull request targets ${pr.baseRefName}, not ${staging}` };
  if (pr.mergeable === 'CONFLICTING') return { kind: 'hand-over', reason: `the pull request has conflicts with ${staging}` };
  if (pr.checks === 'fail') return { kind: 'hand-over', reason: 'the CI of the pull request failed' };
  if (pr.checks === 'none') {
    return deps.now() - Date.parse(entry.queuedAt) >= NO_CHECKS_GRACE_MS
      ? { kind: 'hand-over', reason: 'the pull request has no CI checks, so the orchestrator cannot tell it is green' }
      : { kind: 'wait' };
  }
  if (pr.checks === 'pending' || pr.mergeable === 'UNKNOWN') return { kind: 'wait' };
  return { kind: 'merge', pr };
}

function drop(home: string, entry: PendingMerge): void {
  writeMerges(home, readMerges(home).filter((item) => !(item.project === entry.project && item.task === entry.task)));
}
