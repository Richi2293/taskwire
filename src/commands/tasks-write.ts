import { readFileSync } from 'node:fs';
import type { CommandInput } from '../args.ts';
import { flag, onePositional, optString, optStrings, reqString } from '../args.ts';
import type { RawList, RawTask } from '../clickup-types.ts';
import { localMidnightMs } from '../dates.ts';
import { usageError } from '../errors.ts';
import { loadListInFolder, loadTaskInFolder, normalizeTaskId } from '../guard.ts';
import { toTask } from '../shape.ts';
import type { TaskSummary } from '../shape.ts';
import { matchStatus, parsePriority, projectConfig, resolveAssignee } from './context.ts';
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
  const priorityValue = priority === undefined ? undefined : parsePriority(priority);
  const dueValue = due === undefined ? undefined : localMidnightMs(due);
  if (listId === undefined && parentId === undefined && config.defaultListId === undefined) {
    throw usageError('No list given', 'Pass --list or set "defaultListId" in .taskwire.json');
  }

  let parent: RawTask | undefined;
  if (parentId !== undefined) {
    parent = await loadTaskInFolder(ctx.client, parentId, config.folderId);
    listId = listId ?? parent.list.id;
  }
  const targetListId = listId ?? config.defaultListId;
  if (targetListId === undefined) throw usageError('No list given');
  const list = await loadListInFolder(ctx.client, targetListId, config.folderId);

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

export async function updateTask(ctx: Context, input: CommandInput): Promise<TaskSummary> {
  const { folderId } = projectConfig(ctx);
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

  const priorityValue = priority === undefined ? undefined : parsePriority(priority);
  const dueValue = due === undefined ? undefined : localMidnightMs(due);
  const nothingToDo = [name, description, status, priority, due].every((v) => v === undefined) &&
    addTags.length + removeTags.length + addAssignees.length + removeAssignees.length === 0;
  if (nothingToDo) throw usageError('Nothing to update', 'Run "taskwire --help" to see the update options');

  const task = await loadTaskInFolder(ctx.client, taskId, folderId);
  const path = `/task/${encodeURIComponent(task.id)}`;

  const body: Record<string, unknown> = {};
  if (name !== undefined) body.name = name;
  if (description !== undefined) body.markdown_content = description;
  if (status !== undefined) {
    const list = await ctx.client.request<RawList>('GET', `/list/${task.list.id}`);
    body.status = matchStatus(list, status);
  }
  if (priorityValue !== undefined) body.priority = priorityValue;
  if (dueValue !== undefined) {
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

  if (Object.keys(body).length > 0) await ctx.client.request('PUT', path, { body });
  for (const tag of addTags) await ctx.client.request('POST', `${path}/tag/${encodeURIComponent(tag)}`);
  for (const tag of removeTags) await ctx.client.request('DELETE', `${path}/tag/${encodeURIComponent(tag)}`);

  return toTask(await loadTaskInFolder(ctx.client, task.id, folderId));
}

export async function deleteTask(ctx: Context, input: CommandInput): Promise<{ deleted: string; name: string }> {
  const { folderId } = projectConfig(ctx);
  const taskId = normalizeTaskId(onePositional(input, 'task id'));
  if (!flag(input.values, 'yes')) {
    throw usageError('Refusing to delete without --yes', 'Deleting is permanent: prefer moving the task to a closed status');
  }
  const task = await loadTaskInFolder(ctx.client, taskId, folderId);
  await ctx.client.request('DELETE', `/task/${encodeURIComponent(task.id)}`);
  return { deleted: task.id, name: task.name };
}
