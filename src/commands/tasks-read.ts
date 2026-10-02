import type { CommandInput } from '../args.ts';
import { flag, onePositional, optString, optStrings } from '../args.ts';
import type { QueryValue } from '../client.ts';
import type { RawList, RawTask } from '../clickup-types.ts';
import { AREA_HINT, normalizeArea } from '../area.ts';
import { usageError } from '../errors.ts';
import { localMidnightMs, nextLocalMidnightMs } from '../dates.ts';
import { needsFromTags } from '../needs.ts';
import type { NeedsKind, NeedsTags } from '../needs.ts';
import { toTask, toTaskDetail } from '../shape.ts';
import type { TaskDetail, TaskSummary } from '../shape.ts';
import { loadComments } from './comments.ts';
import { loadProjectList, loadProjectTask, parseNeeds, projectConfig, projectNeedsTags, projectWorkspaceId, resolveAssignee, tagNames } from './context.ts';
import { loadProjectLists } from './lists.ts';
import type { Context } from './context.ts';

export const MAX_PAGES = 50;
const PAGE_SIZE = 100;

const NARROW_HINT = 'Narrow the query with --list, --status or --tag';

// truncatedHint lets commands built on this one suggest only the options they accept.
export async function listTasks(ctx: Context, input: CommandInput, truncatedHint = NARROW_HINT): Promise<TaskSummary[]> {
  const { folderId, listIds, area: projectArea } = projectConfig(ctx);
  const area = readAreaFilter(input, projectArea);
  const listId = optString(input.values, 'list');
  const status = optString(input.values, 'status');
  const assignee = optString(input.values, 'assignee');
  const searchWords = readSearch(input);
  const limit = readLimit(input);
  const dueBefore = optString(input.values, 'due-before');
  const dueAfter = optString(input.values, 'due-after');
  const needsValue = optString(input.values, 'needs');
  const needs = needsValue === undefined ? undefined : parseNeeds(needsValue, 'any');
  const needsTags = projectNeedsTags(ctx);
  const filters: Record<string, QueryValue | undefined> = {
    statuses: status === undefined ? undefined : [status],
    tags: tagNames(optStrings(input.values, 'tag')),
    // Both bounds leave the given day out: before its midnight, or from the next day's midnight.
    due_date_lt: dueBefore === undefined ? undefined : localMidnightMs(dueBefore),
    due_date_gt: dueAfter === undefined ? undefined : nextLocalMidnightMs(dueAfter) - 1,
    assignees: assignee === undefined ? undefined : [await resolveAssignee(ctx, assignee)],
    include_closed: flag(input.values, 'include-closed'),
    subtasks: !flag(input.values, 'top-level'),
  };

  let path: string;
  let list: RawList | undefined;
  if (listId !== undefined) {
    list = await loadProjectList(ctx, listId);
    path = `/list/${listId}/task`;
  } else {
    path = `/team/${await projectWorkspaceId(ctx)}/task`;
    if (listIds === undefined) {
      filters.project_ids = [folderId];
    } else {
      filters.list_ids = listIds;
    }
  }

  let read = 0;
  const found: RawTask[] = [];
  let complete = false;
  for (let page = 0; page < MAX_PAGES && !complete && found.length < limit; page++) {
    const response = await ctx.client.request<{ tasks: RawTask[]; last_page?: boolean }>('GET', path, {
      query: { ...filters, page },
    });
    read += response.tasks.length;
    // list_ids may also return tasks that only show in a project list, while their home list belongs to another project.
    const owned = listIds === undefined ? response.tasks : response.tasks.filter((task) => listIds.includes(task.list.id));
    // Filtered here, so that the area adds to --tag instead of widening it.
    const inArea = area === null ? owned : owned.filter((task) => task.tags.some((tag) => tag.name === area));
    const matching = searchWords === undefined ? inArea : inArea.filter((task) => matchesAllWords(task, searchWords));
    // Filtered here, like --search, so that "any" and --tag keep their meaning.
    found.push(...(needs === undefined ? matching : matching.filter((task) => matchesNeeds(task, needs, needsTags))));
    complete = response.last_page === true || response.tasks.length < PAGE_SIZE;
  }
  if (!complete && found.length < limit) {
    ctx.warn(`Stopped after ${read} tasks, there may be more`, truncatedHint);
  }
  // ClickUp answers an unknown status or list with no tasks, so a typo would look like an empty result.
  const checkLists = read === 0 && (status !== undefined || (list === undefined && listIds !== undefined));
  if (checkLists) {
    const lists = list === undefined ? await loadProjectLists(ctx) : [list];
    if (status !== undefined) assertStatusExists(lists, status);
  }
  return found.slice(0, limit).map((task) => toTask(task, needsTags));
}

// The area whose tasks to keep: --area, or the project's unless --all-areas; null keeps every task.
function readAreaFilter(input: CommandInput, projectArea: string | undefined): string | null {
  const wanted = optString(input.values, 'area');
  const all = flag(input.values, 'all-areas');
  if (wanted !== undefined && all) throw usageError('Use either --area or --all-areas, not both');
  if (all) return null;
  if (wanted === undefined) return projectArea ?? null;
  const tag = normalizeArea(wanted);
  if (tag === null) throw usageError(`Invalid --area "${wanted}"`, AREA_HINT);
  return tag;
}

function matchesNeeds(task: RawTask, wanted: NeedsKind | 'any', needsTags: NeedsTags): boolean {
  const needs = needsFromTags(task.tags.map((tag) => tag.name), needsTags);
  return wanted === 'any' ? needs !== null : needs === wanted;
}

// ClickUp returns the most recently created tasks first, so a limit keeps the newest ones.
function readLimit(input: CommandInput): number {
  const value = optString(input.values, 'limit');
  if (value === undefined) return Infinity;
  if (!/^[1-9]\d*$/.test(value)) throw usageError(`Invalid --limit "${value}"`, 'Use a whole number greater than 0');
  return Number(value);
}

// ClickUp has no text search in its API, so taskwire filters the tasks it reads.
function readSearch(input: CommandInput): string[] | undefined {
  const search = optString(input.values, 'search');
  if (search === undefined) return undefined;
  const words = foldText(search).split(/\s+/).filter((word) => word !== '');
  if (words.length === 0) throw usageError('Empty search', 'Pass one or more words to --search');
  return words;
}

function matchesAllWords(task: RawTask, words: string[]): boolean {
  const text = foldText(`${task.name}\n${task.text_content ?? ''}`);
  return words.every((word) => text.includes(word));
}

// Lowercase without accents, so "priorita" finds "Priorità".
function foldText(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function assertStatusExists(lists: RawList[], wanted: string): void {
  const statuses = [...new Set(lists.flatMap((list) => (list.statuses ?? []).map((s) => s.status)))];
  if (statuses.some((status) => status.toLowerCase() === wanted.trim().toLowerCase())) return;
  throw usageError(`Status "${wanted}" does not exist in this project's lists`, `Valid statuses: ${statuses.join(', ')}`);
}

export async function getTask(ctx: Context, input: CommandInput): Promise<TaskDetail> {
  const limit = readCommentLimit(input);
  const task = await loadProjectTask(ctx, onePositional(input, 'task id'));
  const comments = limit === 0 ? [] : await loadComments(ctx, task.id, limit);
  return toTaskDetail(task, comments, projectNeedsTags(ctx));
}

// Comments can cost up to 20 requests, so agents that only need the description can skip or limit them.
function readCommentLimit(input: CommandInput): number | undefined {
  const value = optString(input.values, 'comments');
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw usageError(`Invalid --comments "${value}"`, 'Use 0 to skip the comments, or the number of recent comments to read');
  return Number(value);
}
