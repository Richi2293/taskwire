import type { CommandInput } from '../args.ts';
import { flag, onePositional, optStrings, reqString } from '../args.ts';
import type { RawChecklist } from '../clickup-types.ts';
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

export async function checkChecklistItem(ctx: Context, input: CommandInput): Promise<ChecklistOut> {
  const { folderId } = projectConfig(ctx);
  const itemId = onePositional(input, 'checklist item id');
  const taskId = reqString(input.values, 'task');
  const task = await loadTaskInFolder(ctx.client, taskId, folderId);
  const owner = (task.checklists ?? []).find((checklist) => checklist.items.some((item) => item.id === itemId));
  if (owner === undefined) {
    throw usageError(`Checklist item ${itemId} is not in task ${task.id}`, `Run "taskwire task get ${task.id}" to see the item ids`);
  }
  const { checklist } = await ctx.client.request<{ checklist: RawChecklist }>(
    'PUT',
    `/checklist/${owner.id}/checklist_item/${encodeURIComponent(itemId)}`,
    { body: { resolved: !flag(input.values, 'uncheck') } },
  );
  return toChecklist(checklist);
}
