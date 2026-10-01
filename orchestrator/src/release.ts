import { DEFAULT_STAGING_BRANCH, mergeLevel } from './config.ts';
import type { ProjectEntry } from './config.ts';
import type { CycleDeps } from './cycle.ts';
import { aheadBy, defaultBranch, fetchRemote, findPullRequest, findReleasePullRequest, mergePullRequest, openReleasePullRequest, remoteCommit } from './github.ts';
import { NO_CHECKS_GRACE_MS, SETTLE_MS } from './merging.ts';
import { readReleases, writeRelease } from './releases.ts';
import type { ReleaseState } from './releases.ts';
import type { TaskSummary } from './taskwire.ts';

// With level main, releases staging to production through a pull request from staging, merged at the staging commit
// once its CI is green and no task of the project waits for a test by hand. It never merges anything else.
export async function processRelease(deps: CycleDeps, project: ProjectEntry): Promise<void> {
  const cwd = project.path;
  const run = deps.runCommand;
  const previous = readReleases(deps.home)[project.path] ?? null;
  const at = new Date(deps.now()).toISOString();
  const note = (event: Record<string, unknown>): void => deps.log?.({ ...event, at, project: project.path });
  // Writes the state, with an event only when it changed, so a waiting release does not fill the diary.
  const set = (state: ReleaseState['state'] | null, reason = '', pr: number | null = null, head: string | null = null): void => {
    if (state === null) {
      if (previous !== null) writeRelease(deps.home, project.path, null);
      return;
    }
    const headSeenAt = head !== null && previous?.head === head ? previous.headSeenAt : head === null ? null : at;
    writeRelease(deps.home, project.path, { state, reason, pr, head, headSeenAt, at });
    // A release that went through has its own event.
    if (state !== 'released' && (previous?.state !== state || previous.reason !== reason)) {
      note({ event: state === 'blocked' ? 'release-blocked' : 'release-waiting', state, reason, pr });
    }
  };

  if (mergeLevel(project) !== 'main') return set(null);
  const production = project.productionBranch ?? (await defaultBranch(run, cwd));
  const staging = project.stagingBranch ?? DEFAULT_STAGING_BRANCH;
  if (production === null || staging === production) return;
  if (!(await fetchRemote(run, cwd))) return;
  if ((await aheadBy(run, cwd, production, staging)) === 0) return set(null);

  const waiting = ((await deps.runTaskwire(['tasks', '--needs', 'test'], cwd)) as TaskSummary[])
    .filter((task) => task.needs === 'test' && (project.area === undefined || task.tags.includes(project.area)));
  if (waiting.length > 0) {
    return set('waiting-test', waiting.length === 1 ? '1 task waits for a test by hand' : `${waiting.length} tasks wait for a test by hand`);
  }

  const head = await remoteCommit(run, cwd, staging);
  const pr = await findReleasePullRequest(run, cwd, production, staging);
  if (pr === null) {
    // A person who closes the release pull request stops the release, until staging moves on.
    if (previous !== null && previous.pr !== null && head !== null && previous.head === head) {
      const last = await findPullRequest(run, cwd, String(previous.pr));
      if (last?.state === 'CLOSED') return set('blocked', `the release pull request was closed: a new one opens when ${staging} moves on`, previous.pr, head);
    }
    await openReleasePullRequest(run, cwd, production, staging);
    note({ event: 'release-opened', base: production, head: staging });
    return set('waiting-ci', 'release pull request opened');
  }
  if (head === null || pr.headRefOid !== head) return set('waiting-ci', `${staging} moved on: waiting for the checks of the new head`, pr.number, head);
  if (pr.mergeable === 'CONFLICTING') return set('blocked', 'the release pull request has conflicts', pr.number, head);
  if (pr.checks === 'fail') return set('blocked', 'the CI of the release failed', pr.number, head);
  const seenAt = previous?.head === head && previous.headSeenAt !== null ? Date.parse(previous.headSeenAt) : deps.now();
  const age = deps.now() - seenAt;
  if (pr.checks === 'none' && age >= NO_CHECKS_GRACE_MS) return set('blocked', 'the release pull request has no CI checks', pr.number, head);
  if (pr.checks !== 'pass' || pr.mergeable === 'UNKNOWN' || age < SETTLE_MS) return set('waiting-ci', 'waiting for the checks of the release', pr.number, head);

  try {
    await mergePullRequest(run, cwd, pr.number, head, 'merge');
  } catch (error) {
    return set('blocked', `the merge failed: ${error instanceof Error ? error.message : String(error)}`, pr.number, head);
  }
  set('released', `${staging} released to ${production}`, pr.number, head);
  note({ event: 'release', pr: pr.number, sha: head });
}
