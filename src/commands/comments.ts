import { readFileSync } from 'node:fs';
import type { CommandInput } from '../args.ts';
import { onePositional, optString } from '../args.ts';
import { usageError } from '../errors.ts';
import { loadTaskInFolder } from '../guard.ts';
import { projectConfig } from './context.ts';
import type { Context } from './context.ts';

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

export async function addComment(ctx: Context, input: CommandInput): Promise<{ id: string; taskId: string }> {
  const { folderId } = projectConfig(ctx);
  const taskId = onePositional(input, 'task id');
  const text = readCommentText(input);
  const task = await loadTaskInFolder(ctx.client, taskId, folderId);
  const created = await ctx.client.request<{ id: string | number }>('POST', `/task/${encodeURIComponent(task.id)}/comment`, {
    body: { comment_text: text, notify_all: false },
  });
  return { id: String(created.id), taskId: task.id };
}
