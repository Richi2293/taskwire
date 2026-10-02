import { DEFAULT_BLOCK_TAG, loadConfig, mergeLevel } from '../config.ts';
import type { ProjectEntry } from '../config.ts';
import { usageError } from '../errors.ts';
import { readLive, removeLive } from '../live.ts';
import { approvalCanMerge, readMerges, writeMerges } from '../merges.ts';
import { readRuns } from '../state.ts';
import type { RunTaskwire, TaskSummary } from '../taskwire.ts';

export const ACTIONS = ['answer', 'accept-proposal', 'approve', 'send-back', 'block', 'accept-task', 'reject-task', 'close', 'close-live'] as const;
export type ActionName = (typeof ACTIONS)[number];

export interface ActionRequest {
  project: string;
  task: string;
  action: ActionName;
  text?: string;
}

export interface ActionDeps {
  home: string;
  runTaskwire: RunTaskwire;
  // Called after a change with the project, and the task when it no longer waits, so the dashboard reads that project again.
  onChange: (project: string, task?: string) => void;
}

// Which kinds of waiting each action fits.
const FITS: Record<ActionName, readonly string[]> = {
  answer: ['decision'],
  'accept-proposal': ['decision'],
  approve: ['test', 'review'],
  'send-back': ['test', 'review'],
  block: ['decision', 'test', 'review'],
  // A task the project analysis proposed waits for a decision; one it found ready to close waits for a review.
  'accept-task': ['decision'],
  'reject-task': ['decision'],
  close: ['review'],
  // A live task waits for nothing: it is checked against live.json instead.
  'close-live': [],
};

const MAX_TEXT = 10_000;
// A task sent back goes to this status, unless the project sets its own start statuses.
const SEND_BACK_STATUS = 'to do';

// The comments come from the same account as the agents, so the text says who wrote it.
const PERSON_PREFIX = 'Answer from the person, via the dashboard:';

// The only changes the dashboard can make, each checked against what the task system says right now.
export function createActions(deps: ActionDeps): (body: unknown) => Promise<void> {
  return async (body) => {
    const request = parseRequest(body);
    const project = loadConfig(deps.home).projects.find((entry) => entry.path === request.project);
    if (project === undefined) throw usageError(`${request.project} is not a project of the orchestrator`);
    if (request.action === 'close-live') {
      await closeLive(deps, project, request.task);
      return;
    }
    // A fresh read, not the dashboard cache: the task may have changed since the page showed it.
    // Every area, since the dashboard shows the tasks with no area too.
    const waiting = (await deps.runTaskwire(['tasks', '--needs', 'any', '--all-areas'], project.path)) as TaskSummary[];
    const task = waiting.find((entry) => entry.id === request.task);
    if (task === undefined || task.needs === null) throw usageError(`Task ${request.task} does not wait for a person any more`, 'Reload the dashboard');
    if (!FITS[request.action].includes(task.needs)) {
      throw usageError(`"${request.action}" does not fit task ${task.id}, which waits for a ${task.needs}`);
    }
    const text = request.text?.trim() ?? '';
    if ((request.action === 'answer' || request.action === 'send-back') && text === '') {
      throw usageError(`"${request.action}" needs a text for the agent`);
    }

    const run = (args: string[]) => deps.runTaskwire(args, project.path);
    if (request.action === 'answer') {
      await run(['comment', 'add', task.id, '--text', `${PERSON_PREFIX}\n\n${text}`]);
      await run(['task', 'update', task.id, '--needs', 'none']);
    } else if (request.action === 'accept-proposal') {
      await run(['comment', 'add', task.id, '--text', `${PERSON_PREFIX}\n\nGo ahead with your proposal.`]);
      await run(['task', 'update', task.id, '--needs', 'none']);
    } else if (request.action === 'approve') {
      await run(['task', 'update', task.id, '--needs', 'none']);
      queueApproved(deps.home, project, task, () => new Date().toISOString());
    } else if (request.action === 'send-back') {
      await run(['comment', 'add', task.id, '--text', `${PERSON_PREFIX}\n\n${text}`]);
      await run(['task', 'update', task.id, '--needs', 'none', '--status', project.startStatuses?.[0] ?? SEND_BACK_STATUS]);
    } else if (request.action === 'accept-task') {
      await run(['comment', 'add', task.id, '--text', `${PERSON_PREFIX}\n\nAccepted: agents may work on this task.`]);
      await run(['task', 'update', task.id, '--needs', 'none', '--remove-tag', project.blockTag ?? DEFAULT_BLOCK_TAG]);
    } else if (request.action === 'reject-task' || request.action === 'close') {
      const status = await closedStatus(project, task, run);
      const why = request.action === 'close' ? 'Closed: the work is done.' : 'Rejected: this task is not needed.';
      await run(['comment', 'add', task.id, '--text', `${PERSON_PREFIX}\n\n${why}`]);
      await run(['task', 'update', task.id, '--needs', 'none', '--status', status]);
    } else {
      await run(['task', 'update', task.id, '--add-tag', project.blockTag ?? DEFAULT_BLOCK_TAG]);
    }
    // Any other answer than an approval withdraws a merge queued for the task: the person did not let it go.
    if (request.action !== 'approve') dropQueued(deps.home, project, task.id);
    // Every action but block clears the mark: the task no longer waits for the person.
    deps.onChange(project.path, request.action === 'block' ? undefined : task.id);
  };
}

// A task whose work reached production, closed by the person: the orchestrator never closes one on its own.
async function closeLive(deps: ActionDeps, project: ProjectEntry, taskId: string): Promise<void> {
  if (!readLive(deps.home).live.some((entry) => entry.project === project.path && entry.task === taskId)) {
    throw usageError(`Task ${taskId} is not live`, 'Reload the dashboard');
  }
  const run = (args: string[]) => deps.runTaskwire(args, project.path);
  // A fresh read: the task may have been closed in the task system meanwhile.
  const task = ((await run(['tasks', '--all-areas'])) as TaskSummary[]).find((entry) => entry.id === taskId);
  if (task === undefined) {
    removeLive(deps.home, project.path, taskId);
    throw usageError(`Task ${taskId} is already closed`, 'Reload the dashboard');
  }
  const status = await closedStatus(project, task, run);
  await run(['comment', 'add', task.id, '--text', `${PERSON_PREFIX}\n\nClosed: the work is in production.`]);
  await run(['task', 'update', task.id, '--needs', 'none', '--status', status]);
  removeLive(deps.home, project.path, taskId);
  deps.onChange(project.path, task.id);
}

// With a merge level, the person's approval lets the orchestrator merge the pull request of the task's last run,
// at the commit that run ended on. A run without a pull request (an old run, a sandboxed agent) leaves the merge to the person.
function queueApproved(home: string, project: ProjectEntry, task: TaskSummary, now: () => string): void {
  if (mergeLevel(project) === 'none') return;
  const last = readRuns(home, RUNS_LOOKED_AT).find((run) => run.project === project.path && run.task === task.id);
  if (!approvalCanMerge(last)) return;
  const queue = readMerges(home).filter((entry) => !(entry.project === project.path && entry.task === task.id));
  queue.push({ project: project.path, task: task.id, name: task.name, branch: last.branch, pr: last.pr, url: '', sha: last.sha, approvedBy: 'person', queuedAt: now() });
  writeMerges(home, queue);
}

const RUNS_LOOKED_AT = 500;

function dropQueued(home: string, project: ProjectEntry, taskId: string): void {
  const queue = readMerges(home);
  const kept = queue.filter((entry) => !(entry.project === project.path && entry.task === taskId));
  if (kept.length !== queue.length) writeMerges(home, kept);
}

// The project may name it; otherwise it is the last status of the task's list, where ClickUp keeps the closed one.
async function closedStatus(project: ProjectEntry, task: TaskSummary, run: (args: string[]) => Promise<unknown>): Promise<string> {
  if (project.closedStatus !== undefined) return project.closedStatus;
  const lists = (await run(['lists'])) as { id: string; statuses?: string[] }[];
  const status = lists.find((list) => list.id === task.list?.id)?.statuses?.at(-1);
  if (status === undefined) {
    throw usageError(`The closed status of task ${task.id} is unknown`, `Set "closedStatus" for ${project.path} in the orchestrator config`);
  }
  return status;
}

function parseRequest(body: unknown): ActionRequest {
  if (typeof body !== 'object' || body === null) throw usageError('The action must be a JSON object');
  const { project, task, action, text } = body as Record<string, unknown>;
  if (typeof project !== 'string' || typeof task !== 'string') throw usageError('The action needs "project" and "task"');
  const name = ACTIONS.find((entry) => entry === action);
  if (name === undefined) throw usageError(`Unknown action ${JSON.stringify(action)}`, `Actions: ${ACTIONS.join(', ')}`);
  if (text !== undefined && (typeof text !== 'string' || text.length > MAX_TEXT)) {
    throw usageError(`"text" must be a string of at most ${MAX_TEXT} characters`);
  }
  return { project, task, action: name, text };
}
