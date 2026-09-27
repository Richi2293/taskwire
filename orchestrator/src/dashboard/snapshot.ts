import { basename } from 'node:path';
import { loadConfig } from '../config.ts';
import { readClaims, readRuns } from '../state.ts';
import type { RunTaskwire, TaskSummary } from '../taskwire.ts';

export interface WaitingItem {
  project: string;
  projectName: string;
  id: string;
  name: string;
  url: string;
  needs: 'decision' | 'test' | 'review';
  status: string;
  // The part for people of the last comment (its quote lines), in the project language.
  note: string[];
}

export interface WorkingItem {
  project: string;
  projectName: string;
  task: string;
  name: string;
  startedAt: string;
}

export interface HistoryItem {
  project: string;
  projectName: string;
  task: string;
  name: string;
  url: string;
  startedAt: string;
  finishedAt: string;
  needs: string | null;
  status: string | null;
  tests: string | null;
  verdict: string | null;
  costUsd: number | null;
}

export interface DashboardState {
  generatedAt: string;
  // Whether agents may take new tasks: "start" begins paused, until play on the dashboard.
  mode: 'paused' | 'working';
  waiting: WaitingItem[];
  working: WorkingItem[];
  history: HistoryItem[];
  problems: { project: string; projectName: string; error: string }[];
}

export interface SnapshotDeps {
  home: string;
  runTaskwire: RunTaskwire;
  now: () => number;
  working?: () => boolean;
}

// The free ClickUp plan allows 100 requests a minute: the page refreshes often, the task system is read at most once a minute.
const CACHE_MS = 60_000;
const HISTORY_LIMIT = 200;
const NEEDS_ORDER = { decision: 0, test: 1, review: 2 } as const;

export type Snapshot = (() => Promise<DashboardState>) & {
  // Forgets the cached reads, after a change made from the dashboard.
  clear: () => void;
};

// Returns a function that builds the dashboard state, reading the task system through a short cache.
export function createSnapshot(deps: SnapshotDeps): Snapshot {
  const cache = new Map<string, { at: number; value: unknown }>();
  const cached = async (args: string[], cwd: string): Promise<unknown> => {
    const key = `${cwd}\n${args.join(' ')}`;
    const hit = cache.get(key);
    if (hit !== undefined && deps.now() - hit.at < CACHE_MS) return hit.value;
    const value = await deps.runTaskwire(args, cwd);
    cache.set(key, { at: deps.now(), value });
    return value;
  };

  const read = async (): Promise<DashboardState> => {
    const config = loadConfig(deps.home);
    const waiting: WaitingItem[] = [];
    const problems: DashboardState['problems'] = [];
    for (const project of config.projects) {
      try {
        const tasks = (await cached(['tasks', '--needs', 'any'], project.path)) as TaskSummary[];
        for (const task of tasks) {
          if (task.needs === null) continue;
          const detail = (await cached(['task', 'get', task.id, '--comments', '1'], project.path)) as { comments?: { text: string }[] };
          waiting.push({
            project: project.path,
            projectName: basename(project.path),
            id: task.id,
            name: task.name,
            url: task.url,
            needs: task.needs,
            status: task.status,
            note: noteForPeople(detail.comments?.[0]?.text ?? ''),
          });
        }
      } catch (error) {
        problems.push({ project: project.path, projectName: basename(project.path), error: error instanceof Error ? error.message : String(error) });
      }
    }
    waiting.sort((a, b) => NEEDS_ORDER[a.needs] - NEEDS_ORDER[b.needs]);

    const working = Object.entries(readClaims(deps.home)).map(([task, claim]) => ({
      project: claim.project,
      projectName: basename(claim.project),
      task,
      name: claim.name,
      startedAt: claim.startedAt,
    }));
    const history = readRuns(deps.home, HISTORY_LIMIT).map((run) => ({
      project: run.project,
      projectName: basename(run.project),
      task: run.task,
      name: run.name,
      url: run.url,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      needs: run.needs,
      status: run.status,
      tests: run.tests ?? null,
      verdict: run.verdict ?? null,
      costUsd: run.costUsd,
    }));
    return {
      generatedAt: new Date(deps.now()).toISOString(),
      mode: deps.working?.() ? 'working' : 'paused',
      waiting,
      working,
      history,
      problems,
    };
  };
  return Object.assign(read, { clear: () => cache.clear() });
}

// taskwire comments open with a quote for people ("> **Next:** ..."): that is what the dashboard shows.
export function noteForPeople(markdown: string): string[] {
  const lines: string[] = [];
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('>')) {
      if (lines.length > 0) break;
      continue;
    }
    const text = line.replace(/^>\s?/, '').replace(/\*\*(.+?)\*\*/g, '$1').trim();
    if (text !== '') lines.push(text);
  }
  return lines;
}
