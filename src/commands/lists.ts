import type { CommandInput } from '../args.ts';
import { optString, reqString } from '../args.ts';
import type { RawList } from '../clickup-types.ts';
import { usageError } from '../errors.ts';
import { toList } from '../shape.ts';
import type { ListOut } from '../shape.ts';
import { loadProjectList, projectConfig } from './context.ts';
import type { Context } from './context.ts';

export async function listLists(ctx: Context, input: CommandInput): Promise<ListOut[]> {
  const folderId = optString(input.values, 'folder');
  if (folderId === undefined) return (await loadProjectLists(ctx)).map(toList);
  // Read only, so any folder is allowed: the setup guide shows the lists before init.
  if (!/^\d+$/.test(folderId)) throw usageError(`Invalid folder id "${folderId}"`, 'Run "taskwire folders" to see the ids');
  return (await loadFolderLists(ctx, folderId)).map(toList);
}

// The lists of the project, each loaded on its own to get its statuses: the listIds of the config, or the whole folder.
export async function loadProjectLists(ctx: Context): Promise<RawList[]> {
  const { folderId, listIds } = projectConfig(ctx);
  const detailed: RawList[] = [];
  if (listIds !== undefined) {
    for (const id of listIds) detailed.push(await loadProjectList(ctx, id));
    return detailed;
  }
  return loadFolderLists(ctx, folderId);
}

async function loadFolderLists(ctx: Context, folderId: string): Promise<RawList[]> {
  const { lists } = await ctx.client.request<{ lists: RawList[] }>('GET', `/folder/${folderId}/list`);
  const detailed: RawList[] = [];
  for (const list of lists) {
    detailed.push(await ctx.client.request<RawList>('GET', `/list/${list.id}`));
  }
  return detailed;
}

export async function createList(ctx: Context, input: CommandInput): Promise<ListOut> {
  const { folderId, listIds } = projectConfig(ctx);
  if (listIds !== undefined) {
    throw usageError(
      'This project is limited to the lists in "listIds", so taskwire does not create lists',
      'Create the list in ClickUp, then add its id to "listIds" in .taskwire.json',
    );
  }
  const name = reqString(input.values, 'name');
  const list = await ctx.client.request<RawList>('POST', `/folder/${folderId}/list`, { body: { name } });
  return toList(list);
}
