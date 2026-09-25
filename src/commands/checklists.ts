import type { CommandInput } from '../args.ts';
import { flag, onePositional, optStrings, reqString } from '../args.ts';
import type { RawChecklist, RawChecklistItem } from '../clickup-types.ts';
import { usageError } from '../errors.ts';
import { loadTaskInFolder } from '../guard.ts';
import { toChecklist } from '../shape.ts';
import type { ChecklistOut } from '../shape.ts';
import { projectConfig } from './context.ts';
import type { Context } from './context.ts';

export async function addChecklist(ctx: Context, input: CommandInput): Promise<ChecklistOut> {
  const { folderId } = projectConfig(ctx);
  const taskId = onePositional(input, 'task id');
  const name = reqString(input.values, 'name');
  const items = optStrings(input.values, 'item');
  const task = await loadTaskInFolder(ctx.client, taskId, folderId);
  let { checklist } = await ctx.client.request<{ checklist: RawChecklist }>('POST', `/task/${encodeURIComponent(task.id)}/checklist`, {
    body: { name },
  });
  for (const item of items) {
    ({ checklist } = await ctx.client.request<{ checklist: RawChecklist }>('POST', `/checklist/${checklist.id}/checklist_item`, {
      body: { name: item },
    }));
  }
  return toChecklist(checklist);
}

export async function addChecklistItems(ctx: Context, input: CommandInput): Promise<ChecklistOut> {
  const { folderId } = projectConfig(ctx);
  const checklistId = onePositional(input, 'checklist id');
  const taskId = reqString(input.values, 'task');
  const items = optStrings(input.values, 'item');
  if (items.length === 0) throw usageError('Missing --item', 'Pass one or more --item <text>');
  const task = await loadTaskInFolder(ctx.client, taskId, folderId);
  let checklist = (task.checklists ?? []).find((candidate) => candidate.id === checklistId);
  if (checklist === undefined) {
    throw usageError(`Checklist ${checklistId} is not in task ${task.id}`, `Run "taskwire task get ${task.id}" to see the checklist ids`);
  }
  for (const item of items) {
    ({ checklist } = await ctx.client.request<{ checklist: RawChecklist }>('POST', `/checklist/${checklist.id}/checklist_item`, {
      body: { name: item },
    }));
  }
  return toChecklist(checklist);
}

// Loads the task named by --task and finds the checklist holding the item, so items of other tasks are refused.
async function findItem(ctx: Context, input: CommandInput): Promise<{ checklist: RawChecklist; item: RawChecklistItem }> {
  const { folderId } = projectConfig(ctx);
  const itemId = onePositional(input, 'checklist item id');
  const taskId = reqString(input.values, 'task');
  const task = await loadTaskInFolder(ctx.client, taskId, folderId);
  for (const checklist of task.checklists ?? []) {
    const item = checklist.items.find((candidate) => candidate.id === itemId);
    if (item !== undefined) return { checklist, item };
  }
  throw usageError(`Checklist item ${itemId} is not in task ${task.id}`, `Run "taskwire task get ${task.id}" to see the item ids`);
}

async function updateItem(ctx: Context, checklistId: string, itemId: string, body: Record<string, unknown>): Promise<ChecklistOut> {
  const { checklist } = await ctx.client.request<{ checklist: RawChecklist }>(
    'PUT',
    `/checklist/${checklistId}/checklist_item/${encodeURIComponent(itemId)}`,
    { body },
  );
  return toChecklist(checklist);
}

export async function checkChecklistItem(ctx: Context, input: CommandInput): Promise<ChecklistOut> {
  const resolved = !flag(input.values, 'uncheck');
  const { checklist, item } = await findItem(ctx, input);
  return updateItem(ctx, checklist.id, item.id, { resolved });
}

export async function renameChecklistItem(ctx: Context, input: CommandInput): Promise<ChecklistOut> {
  const name = reqString(input.values, 'name');
  const { checklist, item } = await findItem(ctx, input);
  return updateItem(ctx, checklist.id, item.id, { name });
}

export async function removeChecklistItem(
  ctx: Context,
  input: CommandInput,
): Promise<{ removed: string; name: string; checklist: string }> {
  if (!flag(input.values, 'yes')) {
    throw usageError('Refusing to remove a checklist item without --yes', 'Removing is permanent: prefer checking the item');
  }
  const { checklist, item } = await findItem(ctx, input);
  await ctx.client.request('DELETE', `/checklist/${checklist.id}/checklist_item/${encodeURIComponent(item.id)}`);
  return { removed: item.id, name: item.name, checklist: checklist.id };
}
