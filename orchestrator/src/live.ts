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
}

const LIVE_FILE = 'live.json';
const RUNS_LOOKED_AT = 1000;
// Older runs are not followed any more: their work was merged long ago, or never will be.
const FOLLOW_DAYS = 30;

export function readLive(home: string): LiveFile {
  const path = join(home, LIVE_FILE);
  if (!existsSync(path)) return { live: [], closed: [] };
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as Partial<LiveFile>;
    return { live: Array.isArray(data.live) ? data.live : [], closed: Array.isArray(data.closed) ? data.closed : [] };
  } catch {
    return { live: [], closed: [] };
  }
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
    return Boolean(run.pr) && Date.parse(run.finishedAt) >= cutoff && !live.has(run.task) && !closed.has(`${project.path}#${run.pr}`);
  });
  if (candidates.length === 0) return;
  const production = project.productionBranch ?? (await defaultBranch(deps.runCommand, project.path));
  if (production === null || !(await fetchRemote(deps.runCommand, project.path))) return;

  let changed = false;
  for (const run of candidates) {
    const number = run.pr ?? 0;
    let pr: PullRequest | null;
    try {
      pr = await findPullRequest(deps.runCommand, project.path, String(number));
    } catch (error) {
      // gh is missing or not logged in: the next tick tries again.
      deps.log?.({ event: 'error', at: new Date(deps.now()).toISOString(), project: project.path, error: error instanceof Error ? error.message : String(error) });
      break;
    }
    if (pr === null) continue;
    if (pr.state === 'CLOSED') {
      file.closed.push(`${project.path}#${number}`);
      changed = true;
    } else if (pr.state === 'MERGED' && pr.mergeCommit !== null && (await isInBranch(deps.runCommand, project.path, pr.mergeCommit, production))) {
      const at = new Date(deps.now()).toISOString();
      file.live.push({ project: project.path, task: run.task, name: run.name, url: run.url, pr: number, at });
      deps.log?.({ event: 'live', at, project: project.path, task: run.task, pr: number });
      changed = true;
    }
  }
  if (changed) writeLive(deps.home, file);
}
