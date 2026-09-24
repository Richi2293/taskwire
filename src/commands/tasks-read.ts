import type { CommandInput } from '../args.ts';
import { flag, onePositional, optString, optStrings } from '../args.ts';
import type { QueryValue } from '../client.ts';
import type { RawComment, RawList, RawTask } from '../clickup-types.ts';
import { usageError } from '../errors.ts';
import { loadListInFolder, loadTaskInFolder } from '../guard.ts';
import { toTask, toTaskDetail } from '../shape.ts';
import type { TaskDetail, TaskSummary } from '../shape.ts';
import { projectConfig, projectWorkspaceId, resolveAssignee } from './context.ts';
import { loadFolderLists } from './lists.ts';
import type { Context } from './context.ts';

export const MAX_PAGES = 50;
const PAGE_SIZE = 100;

export async function listTasks(ctx: Context, input: CommandInput): Promise<TaskSummary[]> {
  const { folderId } = projectConfig(ctx);
  const listId = optString(input.values, 'list');
  const status = optString(input.values, 'status');
  const assignee = optString(input.values, 'assignee');
  const filters: Record<string, QueryValue | undefined> = {
    statuses: status === undefined ? undefined : [status],
    tags: optStrings(input.values, 'tag'),
    assignees: assignee === undefined ? undefined : [await resolveAssignee(ctx, assignee)],
    include_closed: flag(input.values, 'include-closed'),
    subtasks: true,
  };

  let path: string;
  let list: RawList | undefined;
  if (listId !== undefined) {
    list = await loadListInFolder(ctx.client, listId, folderId);
    path = `/list/${listId}/task`;
  } else {
    path = `/team/${await projectWorkspaceId(ctx)}/task`;
    filters.project_ids = [folderId];
  }

  const tasks: RawTask[] = [];
  let complete = false;
  for (let page = 0; page < MAX_PAGES && !complete; page++) {
    const response = await ctx.client.request<{ tasks: RawTask[]; last_page?: boolean }>('GET', path, {
      query: { ...filters, page },
    });
    tasks.push(...response.tasks);
    complete = response.last_page === true || response.tasks.length < PAGE_SIZE;
  }
  if (!complete) {
    ctx.warn(`Stopped after ${tasks.length} tasks, there may be more`, 'Narrow the query with --list, --status or --tag');
  }
  // ClickUp answers an unknown status with no tasks, so a typo would look like an empty result.
  if (status !== undefined && tasks.length === 0) {
    assertStatusExists(list === undefined ? await loadFolderLists(ctx) : [list], status);
  }
  return tasks.map(toTask);
}

function assertStatusExists(lists: RawList[], wanted: string): void {
  const statuses = [...new Set(lists.flatMap((list) => (list.statuses ?? []).map((s) => s.status)))];
  if (statuses.some((status) => status.toLowerCase() === wanted.trim().toLowerCase())) return;
  throw usageError(`Status "${wanted}" does not exist in this project's lists`, `Valid statuses: ${statuses.join(', ')}`);
}

export async function getTask(ctx: Context, input: CommandInput): Promise<TaskDetail> {
  const { folderId } = projectConfig(ctx);
  const task = await loadTaskInFolder(ctx.client, onePositional(input, 'task id'), folderId);
  const { comments } = await ctx.client.request<{ comments: RawComment[] }>('GET', `/task/${encodeURIComponent(task.id)}/comment`);
  return toTaskDetail(task, comments);
}
