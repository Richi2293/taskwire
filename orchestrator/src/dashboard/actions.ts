import { DEFAULT_BLOCK_TAG, loadConfig } from '../config.ts';
import type { ProjectEntry } from '../config.ts';
import { usageError } from '../errors.ts';
import type { RunTaskwire, TaskSummary } from '../taskwire.ts';

export const ACTIONS = ['answer', 'accept-proposal', 'approve', 'send-back', 'block', 'accept-task', 'reject-task', 'close'] as const;
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
    // A fresh read, not the dashboard cache: the task may have changed since the page showed it.
    const waiting = (await deps.runTaskwire(['tasks', '--needs', 'any'], project.path)) as TaskSummary[];
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
    // Every action but block clears the mark: the task no longer waits for the person.
    deps.onChange(project.path, request.action === 'block' ? undefined : task.id);
  };
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
