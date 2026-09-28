import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
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
  // Why the last read of the project failed (a missing token, for example); the data shown is then from readAt.
  error: string | null;
  // When the tasks of the project were last read from the task system; null before the first read.
  readAt: string | null;
  // True while the project is being read again.
  reading: boolean;
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

export interface SyncInfo {
  // The oldest read among the projects: all the data shown is at least this recent. Null while a project was never read.
  readAt: string | null;
  // True while any project is being read.
  reading: boolean;
}

export interface DashboardState {
  generatedAt: string;
  sync: SyncInfo;
  control: ControlInfo;
  projects: ProjectSummary[];
  waiting: WaitingItem[];
  working: WorkingItem[];
  history: HistoryItem[];
  problems: { project: string; projectName: string; error: string }[];
}

export interface StoreDeps {
  home: string;
  runTaskwire: RunTaskwire;
  now: () => number;
  working?: () => boolean;
  nextCheckAt?: () => number | null;
}

export interface Store {
  // The state to show, at once: the last data read from the task system, and fresh local files (claims, runs, config).
  state: () => DashboardState;
  // Someone looks at the page: projects read more than a minute ago are read again in the background.
  look: () => void;
  // Reads one project, or all of them, now (Refresh now on the page).
  refresh: (project?: string) => Promise<void>;
  // An action changed a task: it leaves the queue at once, and its project is read again.
  changed: (project: string, task?: string) => void;
  // Resolves once no read is in progress; for tests and for a clean stop.
  idle: () => Promise<void>;
}

// What the dashboard keeps of a project between reads, in memory and in snapshot.json.
interface ProjectCache {
  readAt: string | null;
  error: string | null;
  // The open tasks of the project, as "taskwire tasks" lists them.
  tasks: TaskSummary[];
  // The detail of each task waiting for a person, with the updatedAt it was read at.
  details: Record<string, TaskDetail>;
}

interface TaskDetail {
  updatedAt: string | null;
  description: string;
  comment: { text: string; date: string | null } | null;
}

// The free ClickUp plan allows 100 requests a minute: a project is read again at most once a minute while someone looks.
const FRESH_MS = 60_000;
const HISTORY_LIMIT = 200;
const SNAPSHOT_FILE = 'snapshot.json';
const NEEDS_ORDER: Record<NeedsKind, number> = { decision: 0, test: 1, review: 2 };

export function createStore(deps: StoreDeps): Store {
  const cache = loadSnapshot(deps.home);
  const reading = new Map<string, Promise<void>>();
  // Projects to read once more after the read in progress, because an action changed them meanwhile.
  const again = new Set<string>();
  // When a read was last tried, so a failing project is not tried at every look.
  const triedAt = new Map<string, number>();

  const readOnce = async (path: string): Promise<void> => {
    triedAt.set(path, deps.now());
    const previous = cache.get(path) ?? emptyCache();
    try {
      const tasks = (await deps.runTaskwire(['tasks'], path)) as TaskSummary[];
      const details: Record<string, TaskDetail> = {};
      await Promise.all(tasks.filter((task) => task.needs !== null).map(async (task) => {
        const known = previous.details[task.id];
        // A comment changes updatedAt too, so an unchanged task has nothing new to read.
        if (known !== undefined && task.updatedAt !== undefined && known.updatedAt === task.updatedAt) {
          details[task.id] = known;
          return;
        }
        details[task.id] = await readDetail(task, path);
      }));
      cache.set(path, { readAt: new Date(deps.now()).toISOString(), error: null, tasks, details });
    } catch (error) {
      cache.set(path, { ...previous, error: error instanceof Error ? error.message : String(error) });
    }
    saveSnapshot(deps.home, cache);
  };

  const readDetail = async (task: TaskSummary, path: string): Promise<TaskDetail> => {
    const detail = (await deps.runTaskwire(['task', 'get', task.id, '--comments', '1'], path)) as {
      description?: string;
      comments?: { text: string; date: string | null }[];
    };
    const last = detail.comments?.[0];
    return { updatedAt: task.updatedAt ?? null, description: detail.description ?? '', comment: last === undefined ? null : { text: last.text, date: last.date } };
  };

  // One read per project at a time: a second call joins it, or asks for one more read after it.
  const read = (path: string, readAgain = false): Promise<void> => {
    const current = reading.get(path);
    if (current !== undefined) {
      if (readAgain) again.add(path);
      return current;
    }
    const work = (async () => {
      do {
        again.delete(path);
        await readOnce(path);
      } while (again.has(path));
      reading.delete(path);
    })();
    reading.set(path, work);
    return work;
  };

  const followed = (): string[] => loadConfig(deps.home).projects.map((project) => project.path);

  const state = (): DashboardState => {
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
      const known = cache.get(project.path) ?? emptyCache();
      const summary: ProjectSummary = {
        project: project.path,
        projectName,
        waiting: { decision: 0, test: 0, review: 0 },
        working: busy,
        doneToday: history.filter((run) => run.project === project.path && new Date(run.finishedAt).toDateString() === today).length,
        error: known.error,
        readAt: known.readAt,
        reading: reading.has(project.path),
      };
      projects.push(summary);
      for (const task of known.tasks) {
        if (task.needs === null) continue;
        summary.waiting[task.needs] += 1;
        waiting.push(waitingItem(task, known.details[task.id], project.path, projectName));
      }
      if (firstTask === null && busy === null) {
        const next = pickTask(known.tasks, { statuses: project.startStatuses ?? DEFAULT_START_STATUSES, blockTag: project.blockTag ?? DEFAULT_BLOCK_TAG });
        if (next !== null) firstTask = { project: project.path, projectName, id: next.id, name: next.name, status: next.status };
      }
    }
    waiting.sort((a, b) => NEEDS_ORDER[a.needs] - NEEDS_ORDER[b.needs]);

    const reads = projects.map((p) => p.readAt);
    const mode = deps.working?.() ? 'working' : 'paused';
    const nextCheckAt = mode === 'working' ? deps.nextCheckAt?.() ?? null : null;
    return {
      generatedAt: new Date(deps.now()).toISOString(),
      sync: {
        readAt: reads.length === 0 || reads.includes(null) ? null : reads.reduce((oldest, at) => (at !== null && oldest !== null && at < oldest ? at : oldest)),
        reading: projects.some((p) => p.reading),
      },
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

  return {
    state,
    look: () => {
      for (const path of followed()) {
        const known = cache.get(path);
        const last = Math.max(known?.readAt ? Date.parse(known.readAt) : 0, triedAt.get(path) ?? 0);
        if (!reading.has(path) && deps.now() - last >= FRESH_MS) void read(path);
      }
    },
    refresh: async (project) => {
      await Promise.all((project === undefined ? followed() : [project]).map((path) => read(path)));
    },
    changed: (project, task) => {
      const known = cache.get(project);
      if (known !== undefined && task !== undefined) {
        known.tasks = known.tasks.map((entry) => (entry.id === task ? { ...entry, needs: null } : entry));
      }
      void read(project, true);
    },
    idle: async () => {
      while (reading.size > 0) await Promise.all(reading.values());
    },
  };
}

function waitingItem(task: TaskSummary, detail: TaskDetail | undefined, project: string, projectName: string): WaitingItem {
  const text = detail?.comment?.text ?? '';
  return {
    project,
    projectName,
    id: task.id,
    name: task.name,
    url: task.url,
    needs: task.needs ?? 'review',
    status: task.status,
    goal: goalFrom(detail?.description ?? ''),
    since: detail?.comment?.date ?? null,
    note: noteForPeople(text),
    ...readSections(text),
  };
}

function emptyCache(): ProjectCache {
  return { readAt: null, error: null, tasks: [], details: {} };
}

// The last data read, so that the page has something to show at once after a restart. A missing or broken file means no data yet.
function loadSnapshot(home: string): Map<string, ProjectCache> {
  const path = join(home, SNAPSHOT_FILE);
  const cache = new Map<string, ProjectCache>();
  if (!existsSync(path)) return cache;
  try {
    const data: unknown = JSON.parse(readFileSync(path, 'utf8'));
    const projects = typeof data === 'object' && data !== null ? (data as { projects?: unknown }).projects : undefined;
    if (typeof projects !== 'object' || projects === null) return cache;
    for (const [project, entry] of Object.entries(projects as Record<string, unknown>)) {
      if (isProjectCache(entry)) cache.set(project, entry);
    }
  } catch {
    // Written by the dashboard itself: if it is broken, the next read replaces it.
  }
  return cache;
}

function isProjectCache(value: unknown): value is ProjectCache {
  if (typeof value !== 'object' || value === null) return false;
  const { readAt, error, tasks, details } = value as Record<string, unknown>;
  return (readAt === null || typeof readAt === 'string')
    && (error === null || typeof error === 'string')
    && Array.isArray(tasks)
    && typeof details === 'object' && details !== null;
}

// Written to a temporary file first, so a stop in the middle never leaves half a file.
function saveSnapshot(home: string, cache: Map<string, ProjectCache>): void {
  let followed: Set<string> | null = null;
  try {
    followed = new Set(loadConfig(home).projects.map((project) => project.path));
  } catch {
    // A broken config: keep every project for now.
  }
  const projects: Record<string, ProjectCache> = {};
  for (const [path, entry] of cache) if (followed === null || followed.has(path)) projects[path] = entry;
  const file = join(home, SNAPSHOT_FILE);
  writeFileSync(`${file}.tmp`, `${JSON.stringify({ projects })}\n`);
  renameSync(`${file}.tmp`, file);
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
