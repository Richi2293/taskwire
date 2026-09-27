import { basename } from 'node:path';
import { DEFAULT_BLOCK_TAG, DEFAULT_INTERVAL_MINUTES, DEFAULT_MAX_AGENTS, DEFAULT_START_STATUSES, loadConfig } from '../config.ts';
import { pickTask } from '../picker.ts';
import { readClaims, readRuns } from '../state.ts';
import type { RunTaskwire, TaskSummary } from '../taskwire.ts';
import { goalFrom, readSections } from './sections.ts';

type NeedsKind = 'decision' | 'test' | 'review';

export interface WaitingItem {
  project: string;
  projectName: string;
  id: string;
  name: string;
  url: string;
  needs: NeedsKind;
  status: string;
  // The first line of the description quote, without its label.
  goal: string | null;
  // When the last comment was written: roughly since when the task waits.
  since: string | null;
  // The part for people of the last comment (its quote lines), in the project language.
  note: string[];
  // The fixed sections of the last comment; empty when the agent did not write them.
  questions: string[];
  proposal: string | null;
  checked: string[];
  byHand: string[];
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

export interface ProjectSummary {
  project: string;
  projectName: string;
  waiting: Record<NeedsKind, number>;
  working: WorkingItem | null;
  doneToday: number;
  // Why the project could not be read (a missing token, for example); null when it was read.
  error: string | null;
}

export interface ControlInfo {
  // Whether agents may take new tasks: "start" begins paused, until play on the dashboard.
  mode: 'paused' | 'working';
  intervalMinutes: number;
  maxAgents: number;
  agentsAtWork: number;
  // When the loop looks for new tasks next; null while paused.
  nextCheckAt: string | null;
  busyProjects: string[];
  // The task an agent would take first: the next one to start when the person presses play.
  firstTask: { project: string; projectName: string; id: string; name: string; status: string } | null;
}

export interface DashboardState {
  generatedAt: string;
  control: ControlInfo;
  projects: ProjectSummary[];
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
  nextCheckAt?: () => number | null;
}

// The free ClickUp plan allows 100 requests a minute: the page refreshes often, the task system is read at most once a minute.
const CACHE_MS = 60_000;
const HISTORY_LIMIT = 200;
const NEEDS_ORDER: Record<NeedsKind, number> = { decision: 0, test: 1, review: 2 };

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
    const today = new Date(deps.now()).toDateString();

    const waiting: WaitingItem[] = [];
    const projects: ProjectSummary[] = [];
    let firstTask: ControlInfo['firstTask'] = null;
    for (const project of config.projects) {
      const projectName = basename(project.path);
      const busy = working.find((item) => item.project === project.path) ?? null;
      const summary: ProjectSummary = {
        project: project.path,
        projectName,
        waiting: { decision: 0, test: 0, review: 0 },
        working: busy,
        doneToday: history.filter((run) => run.project === project.path && new Date(run.finishedAt).toDateString() === today).length,
        error: null,
      };
      projects.push(summary);
      try {
        const tasks = (await cached(['tasks', '--needs', 'any'], project.path)) as TaskSummary[];
        for (const task of tasks) {
          if (task.needs === null) continue;
          summary.waiting[task.needs] += 1;
          waiting.push(await waitingItem(task, project.path, projectName));
        }
        if (firstTask === null && busy === null) {
          const all = (await cached(['tasks'], project.path)) as TaskSummary[];
          const next = pickTask(all, { statuses: project.startStatuses ?? DEFAULT_START_STATUSES, blockTag: project.blockTag ?? DEFAULT_BLOCK_TAG });
          if (next !== null) firstTask = { project: project.path, projectName, id: next.id, name: next.name, status: next.status };
        }
      } catch (error) {
        summary.error = error instanceof Error ? error.message : String(error);
      }
    }
    waiting.sort((a, b) => NEEDS_ORDER[a.needs] - NEEDS_ORDER[b.needs]);

    const mode = deps.working?.() ? 'working' : 'paused';
    const nextCheckAt = mode === 'working' ? deps.nextCheckAt?.() ?? null : null;
    return {
      generatedAt: new Date(deps.now()).toISOString(),
      control: {
        mode,
        intervalMinutes: config.intervalMinutes ?? DEFAULT_INTERVAL_MINUTES,
        maxAgents: config.maxAgents ?? DEFAULT_MAX_AGENTS,
        agentsAtWork: working.length,
        nextCheckAt: nextCheckAt === null ? null : new Date(nextCheckAt).toISOString(),
        busyProjects: projects.filter((p) => p.working !== null).map((p) => p.projectName),
        firstTask,
      },
      projects,
      waiting,
      working,
      history,
      problems: projects.filter((p) => p.error !== null).map((p) => ({ project: p.project, projectName: p.projectName, error: p.error ?? '' })),
    };
  };

  const waitingItem = async (task: TaskSummary, project: string, projectName: string): Promise<WaitingItem> => {
    const detail = (await cached(['task', 'get', task.id, '--comments', '1'], project)) as {
      description?: string;
      comments?: { text: string; date: string | null }[];
    };
    const last = detail.comments?.[0];
    return {
      project,
      projectName,
      id: task.id,
      name: task.name,
      url: task.url,
      needs: task.needs ?? 'review',
      status: task.status,
      goal: goalFrom(detail.description ?? ''),
      since: last?.date ?? null,
      note: noteForPeople(last?.text ?? ''),
      ...readSections(last?.text ?? ''),
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
