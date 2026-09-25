import { readFileSync } from 'node:fs';
import type { CommandInput } from '../args.ts';
import { flag, onePositional, optString, optStrings, reqString } from '../args.ts';
import type { RawList, RawTask } from '../clickup-types.ts';
import { localMidnightMs } from '../dates.ts';
import { EXIT, TaskwireError, usageError } from '../errors.ts';
import { normalizeTaskId } from '../guard.ts';
import { toTask } from '../shape.ts';
import type { TaskSummary } from '../shape.ts';
import { loadProjectList, loadProjectTask, matchStatus, parsePriority, projectConfig, projectWorkspaceId, resolveAssignee } from './context.ts';
import type { Context } from './context.ts';

export function readDescription(input: CommandInput): string | undefined {
  const text = optString(input.values, 'description');
  const file = optString(input.values, 'description-file');
  if (text !== undefined && file !== undefined) {
    throw usageError('Use either --description or --description-file, not both');
  }
  if (file === undefined) return text;
  try {
    return readFileSync(file, 'utf8');
  } catch {
    throw usageError(`Cannot read description file ${file}`);
  }
}

// "none" clears a value, which only makes sense on a task that already has one.
function isClear(value: string): boolean {
  return value.trim().toLowerCase() === 'none';
}

function rejectClear(option: string, value: string | undefined): void {
  if (value !== undefined && isClear(value)) {
    throw usageError(`Invalid ${option} "${value}"`, `"none" clears the ${option}, so it works only with task update`);
  }
}

export async function createTask(ctx: Context, input: CommandInput): Promise<TaskSummary> {
  const config = projectConfig(ctx);
  const name = reqString(input.values, 'name');
  const description = readDescription(input);
  const status = optString(input.values, 'status');
  const priority = optString(input.values, 'priority');
  const due = optString(input.values, 'due');
  const parentId = optString(input.values, 'parent');
  let listId = optString(input.values, 'list');

  // Validate every local input before the first network call.
  rejectClear('priority', priority);
  rejectClear('due date', due);
  const priorityValue = priority === undefined ? undefined : parsePriority(priority);
  const dueValue = due === undefined ? undefined : localMidnightMs(due);
  if (listId === undefined && parentId === undefined && config.defaultListId === undefined) {
    throw usageError('No list given', 'Pass --list or set "defaultListId" in .taskwire.json');
  }

  let parent: RawTask | undefined;
  if (parentId !== undefined) {
    parent = await loadProjectTask(ctx, parentId);
    listId = listId ?? parent.list.id;
  }
  const targetListId = listId ?? config.defaultListId;
  if (targetListId === undefined) throw usageError('No list given');
  const list = await loadProjectList(ctx, targetListId);

  const assignees: number[] = [];
  for (const value of optStrings(input.values, 'assignee')) assignees.push(await resolveAssignee(ctx, value));
  const tags = optStrings(input.values, 'tag');

  const body: Record<string, unknown> = { name };
  if (description !== undefined) body.markdown_content = description;
  if (status !== undefined) body.status = matchStatus(list, status);
  if (priorityValue !== undefined) body.priority = priorityValue;
  if (tags.length > 0) body.tags = tags;
  if (assignees.length > 0) body.assignees = assignees;
  if (dueValue !== undefined) {
    body.due_date = dueValue;
    body.due_date_time = false;
  }
  if (parent !== undefined) body.parent = parent.id;

  const created = await ctx.client.request<RawTask>('POST', `/list/${list.id}/task`, { body });
  return toTask(created);
}

// Checks --list and --parent before any network call and returns the normalized parent id.
function readMove(input: CommandInput, taskId: string): { listId?: string; parentId?: string } {
  const listId = optString(input.values, 'list');
  const parent = optString(input.values, 'parent');
  if (parent === undefined) return { listId };
  if (listId !== undefined) {
    throw usageError('Use either --list or --parent, not both', 'A new parent already moves the task to the parent list');
  }
  if (isClear(parent)) {
    throw usageError('A subtask cannot be detached from its parent here', 'The ClickUp API does not support it: do it in the ClickUp UI');
  }
  const parentId = normalizeTaskId(parent);
  if (parentId === taskId) throw usageError(`Task ${taskId} cannot be a subtask of itself`);
  return { parentId };
}

export async function updateTask(ctx: Context, input: CommandInput): Promise<TaskSummary> {
  const taskId = normalizeTaskId(onePositional(input, 'task id'));
  const name = optString(input.values, 'name');
  const description = readDescription(input);
  const status = optString(input.values, 'status');
  const priority = optString(input.values, 'priority');
  const due = optString(input.values, 'due');
  const addTags = optStrings(input.values, 'add-tag');
  const removeTags = optStrings(input.values, 'remove-tag');
  const addAssignees = optStrings(input.values, 'add-assignee');
  const removeAssignees = optStrings(input.values, 'remove-assignee');
  const { listId, parentId } = readMove(input, taskId);

  let priorityValue: number | null | undefined;
  if (priority !== undefined) priorityValue = isClear(priority) ? null : parsePriority(priority);
  let dueValue: number | null | undefined;
  if (due !== undefined) dueValue = isClear(due) ? null : localMidnightMs(due);
  const nothingToDo = [name, description, status, priority, due, listId, parentId].every((v) => v === undefined) &&
    addTags.length + removeTags.length + addAssignees.length + removeAssignees.length === 0;
  if (nothingToDo) throw usageError('Nothing to update', 'Run "taskwire --help" to see the update options');

  const task = await loadProjectTask(ctx, taskId);
  const path = `/task/${encodeURIComponent(task.id)}`;
  const targetList = listId === undefined ? undefined : await loadProjectList(ctx, listId);
  if (targetList !== undefined && task.parent !== null) {
    throw usageError(
      `Task ${task.id} is a subtask and cannot be moved to another list on its own`,
      'Move its parent with --list, or give it another parent with --parent',
    );
  }
  const parent = parentId === undefined ? undefined : await loadProjectTask(ctx, parentId);

  const body: Record<string, unknown> = {};
  if (name !== undefined) body.name = name;
  if (description !== undefined) body.markdown_content = description;
  if (status !== undefined) {
    // After a move the status must exist in the list the task ends up in.
    const list = targetList ?? (await ctx.client.request<RawList>('GET', `/list/${parent?.list.id ?? task.list.id}`));
    body.status = matchStatus(list, status);
  }
  if (parent !== undefined) body.parent = parent.id;
  if (priorityValue !== undefined) body.priority = priorityValue;
  if (dueValue === null) {
    body.due_date = null;
  } else if (dueValue !== undefined) {
    body.due_date = dueValue;
    body.due_date_time = false;
  }
  if (addAssignees.length + removeAssignees.length > 0) {
    const add: number[] = [];
    const rem: number[] = [];
    for (const value of addAssignees) add.push(await resolveAssignee(ctx, value));
    for (const value of removeAssignees) rem.push(await resolveAssignee(ctx, value));
    body.assignees = { add, rem };
  }

  const steps: UpdateStep[] = [];
  if (targetList !== undefined) {
    // Only the v3 API can change the list of a task; its subtasks follow it.
    const movePath = `/workspaces/${await projectWorkspaceId(ctx)}/tasks/${encodeURIComponent(task.id)}/home_list/${targetList.id}`;
    steps.push({ label: `move to list "${targetList.name}"`, apply: () => ctx.client.request('PUT', movePath, { api: 'v3' }) });
  }
  if (Object.keys(body).length > 0) {
    steps.push({ label: 'fields', apply: () => ctx.client.request('PUT', path, { body }) });
  }
  for (const tag of addTags) {
    steps.push({ label: `add tag "${tag}"`, apply: () => ctx.client.request('POST', `${path}/tag/${encodeURIComponent(tag)}`) });
  }
  for (const tag of removeTags) {
    steps.push({ label: `remove tag "${tag}"`, apply: () => ctx.client.request('DELETE', `${path}/tag/${encodeURIComponent(tag)}`) });
  }
  await applySteps(task.id, steps);

  return toTask(await loadProjectTask(ctx, task.id));
}

interface UpdateStep {
  label: string;
  apply: () => Promise<unknown>;
}

// ClickUp changes tags one call at a time, so a failure after the first call leaves the task partly updated.
async function applySteps(taskId: string, steps: UpdateStep[]): Promise<void> {
  for (const [index, step] of steps.entries()) {
    try {
      await step.apply();
    } catch (error) {
      if (index === 0) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      const exitCode = error instanceof TaskwireError ? error.exitCode : EXIT.api;
      const labels = (list: UpdateStep[]) => list.map((s) => s.label).join(', ');
      throw new TaskwireError(
        `Task ${taskId} was partly updated: ${step.label} failed with ${reason}`,
        exitCode,
        `Applied: ${labels(steps.slice(0, index))}. Not applied: ${labels(steps.slice(index))}`,
      );
    }
  }
}

export async function deleteTask(ctx: Context, input: CommandInput): Promise<{ deleted: string; name: string }> {
  const taskId = normalizeTaskId(onePositional(input, 'task id'));
  if (!flag(input.values, 'yes')) {
    throw usageError('Refusing to delete without --yes', 'Deleting is permanent: prefer moving the task to a closed status');
  }
  const task = await loadProjectTask(ctx, taskId);
  await ctx.client.request('DELETE', `/task/${encodeURIComponent(task.id)}`);
  return { deleted: task.id, name: task.name };
}
