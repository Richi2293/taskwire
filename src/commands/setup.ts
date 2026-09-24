import type { CommandInput } from '../args.ts';
import { flag, optString, reqString } from '../args.ts';
import type { RawUser } from '../clickup-types.ts';
import { writeConfig } from '../config.ts';
import type { ProjectConfig } from '../config.ts';
import { usageError } from '../errors.ts';
import { loadListInFolder } from '../guard.ts';
import type { Context } from './context.ts';

interface Named {
  id: string;
  name: string;
}

export async function whoami(ctx: Context): Promise<{ id: number; username: string | null; email: string | null }> {
  const { user } = await ctx.client.request<{ user: RawUser }>('GET', '/user');
  return { id: user.id, username: user.username, email: user.email ?? null };
}

export async function folders(ctx: Context): Promise<{ id: string; name: string; space: string; workspace: string }[]> {
  const { teams } = await ctx.client.request<{ teams: Named[] }>('GET', '/team');
  const rows: { id: string; name: string; space: string; workspace: string }[] = [];
  for (const team of teams) {
    const { spaces } = await ctx.client.request<{ spaces: Named[] }>('GET', `/team/${team.id}/space`);
    for (const space of spaces) {
      const { folders: found } = await ctx.client.request<{ folders: Named[] }>('GET', `/space/${space.id}/folder`);
      for (const folder of found) {
        rows.push({ id: folder.id, name: folder.name, space: space.name, workspace: team.name });
      }
    }
  }
  return rows;
}

export async function init(
  ctx: Context,
  input: CommandInput,
): Promise<{ path: string; folderId: string; folderName: string; defaultListId: string | null }> {
  const folderId = reqString(input.values, 'folder');
  if (!/^\d+$/.test(folderId)) throw usageError(`Invalid folder id "${folderId}"`, 'Run "taskwire folders" to see the ids');
  const listId = optString(input.values, 'list');
  const folder = await ctx.client.request<Named>('GET', `/folder/${folderId}`);
  if (listId !== undefined) await loadListInFolder(ctx.client, listId, folderId);
  const config: ProjectConfig =
    listId === undefined ? { provider: 'clickup', folderId } : { provider: 'clickup', folderId, defaultListId: listId };
  const path = writeConfig(ctx.cwd, config, flag(input.values, 'force'));
  return { path, folderId, folderName: folder.name, defaultListId: listId ?? null };
}
