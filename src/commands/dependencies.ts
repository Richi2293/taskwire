import type { CommandInput } from '../args.ts';
import { onePositional, reqString } from '../args.ts';
import { loadTaskInFolder } from '../guard.ts';
import { projectConfig } from './context.ts';
import type { Context } from './context.ts';

type DependencyAction = 'add' | 'remove';

export function changeDependency(action: DependencyAction) {
  return async (
    ctx: Context,
    input: CommandInput,
  ): Promise<{ taskId: string; blockedBy: string; action: DependencyAction }> => {
    const { folderId } = projectConfig(ctx);
    const task = await loadTaskInFolder(ctx.client, onePositional(input, 'task id'), folderId);
    const blocker = await loadTaskInFolder(ctx.client, reqString(input.values, 'blocked-by'), folderId);
    const path = `/task/${encodeURIComponent(task.id)}/dependency`;
    if (action === 'add') {
      await ctx.client.request('POST', path, { body: { depends_on: blocker.id } });
    } else {
      await ctx.client.request('DELETE', path, { query: { depends_on: blocker.id } });
    }
    return { taskId: task.id, blockedBy: blocker.id, action };
  };
}
