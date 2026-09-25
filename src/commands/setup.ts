import type { CommandInput } from '../args.ts';
import { flag, optString, optStrings, reqString } from '../args.ts';
import type { RawUser } from '../clickup-types.ts';
import { readConventions, readListIds, writeConfig } from '../config.ts';
import type { ProjectConfig } from '../config.ts';
import { usageError } from '../errors.ts';
import { loadListInFolder } from '../guard.ts';
import { findWorkspaceId, projectConfig } from './context.ts';
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

interface InitResult {
  path: string;
  workspaceId: string;
  folderId: string;
  folderName: string;
  listIds: string[] | null;
  defaultListId: string | null;
}

export async function init(ctx: Context, input: CommandInput): Promise<InitResult> {
  const folderId = reqString(input.values, 'folder');
  if (!/^\d+$/.test(folderId)) throw usageError(`Invalid folder id "${folderId}"`, 'Run "taskwire folders" to see the ids');
  const listId = optString(input.values, 'list');
  const scopeListIds = readScopeLists(input, listId);
  const folder = await ctx.client.request<Named & { space: { id: string } }>('GET', `/folder/${folderId}`);
  const workspaceId = await findWorkspaceId(ctx.client, folder.space.id);

  // --force keeps the project lists of the same folder unless new ones are given.
  const listIds = scopeListIds ?? readListIds(ctx.cwd, folderId);
  if (listIds !== undefined) {
    for (const id of listIds) await loadListInFolder(ctx.client, id, folderId);
  }
  if (listId !== undefined) await loadListInFolder(ctx.client, listId, folderId, listIds);
  // With a single project list there is nothing to choose, so it is also the default list.
  const defaultListId = listId ?? (listIds?.length === 1 ? listIds[0] : undefined);

  const config: ProjectConfig = { provider: 'clickup', workspaceId, folderId };
  if (listIds !== undefined) config.listIds = listIds;
  if (defaultListId !== undefined) config.defaultListId = defaultListId;
  const conventions = readConventions(ctx.cwd);
  if (conventions !== undefined) config.conventions = conventions;
  const path = writeConfig(ctx.cwd, config, flag(input.values, 'force'));
  return { path, workspaceId, folderId, folderName: folder.name, listIds: listIds ?? null, defaultListId: defaultListId ?? null };
}

// The --scope-list values, checked before any network call.
function readScopeLists(input: CommandInput, listId: string | undefined): string[] | undefined {
  const ids = optStrings(input.values, 'scope-list');
  if (ids.length === 0) return undefined;
  for (const id of ids) {
    if (!/^\d+$/.test(id)) throw usageError(`Invalid list id "${id}"`, 'Run "taskwire lists" to see the list ids');
  }
  if (new Set(ids).size !== ids.length) throw usageError('The same --scope-list is given twice');
  if (listId !== undefined && !ids.includes(listId)) {
    throw usageError(`The default list ${listId} is not one of the --scope-list lists`, 'Add it with --scope-list or pick one of them');
  }
  return ids;
}

export const DEFAULT_LANGUAGE = 'English';

export function conventions(ctx: Context): { language: string; instructions: string | null } {
  const found = projectConfig(ctx).conventions;
  return { language: found?.language ?? DEFAULT_LANGUAGE, instructions: found?.instructions ?? null };
}
