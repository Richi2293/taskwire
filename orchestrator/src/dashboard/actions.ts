import { DEFAULT_BLOCK_TAG, loadConfig } from '../config.ts';
import { usageError } from '../errors.ts';
import type { RunTaskwire, TaskSummary } from '../taskwire.ts';

export const ACTIONS = ['answer', 'accept-proposal', 'approve', 'send-back', 'block'] as const;
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
  // Called after a change, so the dashboard reads the task system again instead of its cache.
  onChange: () => void;
}

// Which kinds of waiting each action fits.
const FITS: Record<ActionName, readonly string[]> = {
  answer: ['decision'],
  'accept-proposal': ['decision'],
  approve: ['test', 'review'],
  'send-back': ['test', 'review'],
  block: ['decision', 'test', 'review'],
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
    } else {
      await run(['task', 'update', task.id, '--add-tag', project.blockTag ?? DEFAULT_BLOCK_TAG]);
    }
    deps.onChange();
  };
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
