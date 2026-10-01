import type { CycleDeps } from './cycle.ts';
import { DEFAULT_STAGING_BRANCH, mergeLevel } from './config.ts';
import type { ProjectEntry } from './config.ts';
import { currentBranch, findPullRequest } from './github.ts';
import type { PullRequest } from './github.ts';
import { readMerges, writeMerges } from './merges.ts';
import { setProjectAgents } from './projects.ts';
import type { TaskSummary } from './taskwire.ts';

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
