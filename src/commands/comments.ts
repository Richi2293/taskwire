import { readFileSync } from 'node:fs';
import type { CommandInput } from '../args.ts';
import { onePositional, optString, reqString } from '../args.ts';
import type { RawComment } from '../clickup-types.ts';
import { usageError } from '../errors.ts';
import { loadProjectTask } from './context.ts';
import type { Context } from './context.ts';

export const MAX_COMMENT_PAGES = 20;
const COMMENT_PAGE_SIZE = 25;

function readCommentText(input: CommandInput): string {
  const text = optString(input.values, 'text');
  const file = optString(input.values, 'file');
  if ((text === undefined) === (file === undefined)) throw usageError('Pass exactly one of --text or --file');
  if (text !== undefined) return text;
  try {
    return readFileSync(file as string, 'utf8');
  } catch {
    throw usageError(`Cannot read comment file ${file}`);
  }
}

// ClickUp returns comments newest first, 25 at a time; older pages start from the oldest comment seen.
// With a limit, only the pages holding the most recent `limit` comments are read.
export async function loadComments(ctx: Context, taskId: string, limit = Infinity): Promise<RawComment[]> {
  const path = `/task/${encodeURIComponent(taskId)}/comment`;
  const comments: RawComment[] = [];
  let complete = false;
  for (let page = 0; page < MAX_COMMENT_PAGES && !complete && comments.length < limit; page++) {
    const oldest = comments.at(-1);
    const query = oldest === undefined ? {} : { start: oldest.date, start_id: oldest.id };
    const response = await ctx.client.request<{ comments: RawComment[] }>('GET', path, { query });
    comments.push(...response.comments);
    complete = response.comments.length < COMMENT_PAGE_SIZE;
  }
  if (!complete && comments.length < limit) {
    ctx.warn(`Stopped after ${comments.length} comments, older ones are missing`, 'Open the task in ClickUp to read the full history');
  }
  return comments.slice(0, limit);
}

export async function addComment(ctx: Context, input: CommandInput): Promise<{ id: string; taskId: string }> {
  const taskId = onePositional(input, 'task id');
  const text = readCommentText(input);
  const task = await loadProjectTask(ctx, taskId);
  const created = await ctx.client.request<{ id: string | number }>('POST', `/task/${encodeURIComponent(task.id)}/comment`, {
    // comment_markdown is rendered by ClickUp; comment_text would show the markdown as plain text.
    body: { comment_markdown: text, notify_all: false },
  });
  return { id: String(created.id), taskId: task.id };
}

export async function updateComment(ctx: Context, input: CommandInput): Promise<{ id: string; taskId: string }> {
  const commentId = onePositional(input, 'comment id');
  const taskId = reqString(input.values, 'task');
  const text = readCommentText(input);
  const task = await loadProjectTask(ctx, taskId);
  const comment = (await loadComments(ctx, task.id)).find((candidate) => candidate.id === commentId);
  if (comment === undefined) {
    throw usageError(`Comment ${commentId} is not in task ${task.id}`, `Run "taskwire task get ${task.id}" to see the comment ids`);
  }
  // ClickUp requires assignee and resolved on every update: send the current values so only the text changes.
  const body: { comment_markdown: string; resolved: boolean; assignee?: number } = {
    comment_markdown: text,
    resolved: comment.resolved ?? false,
  };
  if (comment.assignee) body.assignee = comment.assignee.id;
  await ctx.client.request<unknown>('PUT', `/comment/${encodeURIComponent(commentId)}`, { body });
  return { id: commentId, taskId: task.id };
}
