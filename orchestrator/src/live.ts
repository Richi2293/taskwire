import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProjectEntry } from './config.ts';
import type { CycleDeps } from './cycle.ts';
import { defaultBranch, fetchRemote, findPullRequest, isInBranch } from './github.ts';
import type { PullRequest } from './github.ts';
import { readRuns } from './state.ts';

// A task whose work reached production: the person may close it.
export interface LiveTask {
  project: string;
  task: string;
  name: string;
  url: string;
  pr: number;
  at: string;
}

interface LiveFile {
  live: LiveTask[];
  // Pull requests closed without merging, as "project#number": never asked again.
  closed: string[];
  // The merge commit of pull requests merged but not in production yet: checked with git only, no more gh.
  merged: Record<string, string>;
  // When an open pull request was last asked, so it is asked at most every ASK_AGAIN_MS.
  asked: Record<string, string>;
}

const LIVE_FILE = 'live.json';
const RUNS_LOOKED_AT = 1000;
// Older runs are not followed any more: their work was merged long ago, or never will be.
const FOLLOW_DAYS = 30;
// gh is asked about an open pull request at most this often: every tick would spend the GitHub rate limit.
const ASK_AGAIN_MS = 30 * 60_000;

export function readLive(home: string): LiveFile {
  const path = join(home, LIVE_FILE);
  const empty = (): LiveFile => ({ live: [], closed: [], merged: {}, asked: {} });
  if (!existsSync(path)) return empty();
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as Partial<LiveFile>;
    const record = (value: unknown): Record<string, string> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, string>) : {});
    return {
      live: Array.isArray(data.live) ? data.live : [],
      closed: Array.isArray(data.closed) ? data.closed : [],
      merged: record(data.merged),
      asked: record(data.asked),
    };
  } catch {
    return empty();
  }
}

// The person closed the task: it leaves the live list.
export function removeLive(home: string, project: string, task: string): void {
  const file = readLive(home);
  file.live = file.live.filter((entry) => !(entry.project === project && entry.task === task));
  writeLive(home, file);
}

function writeLive(home: string, file: LiveFile): void {
  mkdirSync(home, { recursive: true });
  const path = join(home, LIVE_FILE);
  writeFileSync(`${path}.tmp`, `${JSON.stringify(file, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
}

// Records the tasks of a project whose pull request is merged into the production branch, whoever merged it.
// It only reads: the pull request of the latest run of each recent task, and the remote branches.
export async function trackLive(deps: CycleDeps, project: ProjectEntry): Promise<void> {
  const file = readLive(deps.home);
  const live = new Set(file.live.filter((entry) => entry.project === project.path).map((entry) => entry.task));
  const closed = new Set(file.closed);
  const cutoff = deps.now() - FOLLOW_DAYS * 86_400_000;
  const seen = new Set<string>();
  const candidates = readRuns(deps.home, RUNS_LOOKED_AT).filter((run) => {
    if (run.project !== project.path || seen.has(run.task)) return false;
    // Runs come newest first: only the latest run of a task counts.
    seen.add(run.task);
    if (!run.pr || Date.parse(run.finishedAt) < cutoff || live.has(run.task)) return false;
    const key = `${project.path}#${run.pr}`;
    const askedAt = file.asked[key];
    return !closed.has(key) && (key in file.merged || askedAt === undefined || deps.now() - Date.parse(askedAt) >= ASK_AGAIN_MS);
  });
  if (candidates.length === 0) return;
  const production = project.productionBranch ?? (await defaultBranch(deps.runCommand, project.path));
  if (production === null || !(await fetchRemote(deps.runCommand, project.path))) return;

  let changed = false;
  for (const run of candidates) {
    const number = run.pr ?? 0;
    const key = `${project.path}#${number}`;
    let mergeCommit: string | null = file.merged[key] ?? null;
    if (mergeCommit === null) {
      let pr: PullRequest | null;
      try {
        pr = await findPullRequest(deps.runCommand, project.path, String(number));
      } catch (error) {
        // gh is missing or not logged in: the next tick tries again.
        deps.log?.({ event: 'error', at: new Date(deps.now()).toISOString(), project: project.path, error: error instanceof Error ? error.message : String(error) });
        break;
      }
      changed = true;
      if (pr?.state === 'CLOSED') {
        file.closed.push(key);
        continue;
      }
      if (pr?.state !== 'MERGED' || pr.mergeCommit === null) {
        file.asked[key] = new Date(deps.now()).toISOString();
        continue;
      }
      mergeCommit = pr.mergeCommit;
      file.merged[key] = mergeCommit;
    }
    if (await isInBranch(deps.runCommand, project.path, mergeCommit, production)) {
      const at = new Date(deps.now()).toISOString();
      file.live.push({ project: project.path, task: run.task, name: run.name, url: run.url, pr: number, at });
      delete file.merged[key];
      delete file.asked[key];
      deps.log?.({ event: 'live', at, project: project.path, task: run.task, pr: number });
      changed = true;
    }
  }
  if (changed) writeLive(deps.home, file);
}
