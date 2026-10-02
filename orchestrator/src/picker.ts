import type { TaskSummary } from './taskwire.ts';

export interface PickOptions {
  // Statuses a task must have to be picked, matched ignoring case.
  statuses: string[];
  // Tag that keeps the orchestrator away from a task.
  blockTag: string;
  // When set, only tasks with this tag belong to the project.
  area?: string;
}

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const NO_PRIORITY_RANK = 4;

// The task an agent should work on next, or null. Tasks come from "taskwire tasks", newest created first.
export function pickTask(tasks: TaskSummary[], options: PickOptions): TaskSummary | null {
  const statuses = options.statuses.map((status) => status.toLowerCase());
  // A task with subtasks is a container: the work is in the subtasks.
  const parents = new Set(tasks.map((task) => task.parent).filter((parent): parent is string => parent !== null));
  // The list holds only open tasks: a task waiting for one of them must wait its turn.
  const open = new Set(tasks.map((task) => task.id));
  const candidates = tasks
    // The later a task comes in the list, the older it is.
    .map((task, index) => ({ task, index }))
    .filter(({ task }) =>
      statuses.includes(task.status.toLowerCase()) &&
      task.needs === null &&
      !task.tags.includes(options.blockTag) &&
      (options.area === undefined || task.tags.includes(options.area)) &&
      !(task.blockedBy ?? []).some((id) => open.has(id)) &&
      !parents.has(task.id),
    );
  candidates.sort((a, b) => rank(a.task) - rank(b.task) || b.index - a.index);
  return candidates[0]?.task ?? null;
}

function rank(task: TaskSummary): number {
  return task.priority === null ? NO_PRIORITY_RANK : (PRIORITY_RANK[task.priority] ?? NO_PRIORITY_RANK);
}
