import type { CommandInput } from '../args.ts';
import { reqString } from '../args.ts';
import type { RawList } from '../clickup-types.ts';
import { usageError } from '../errors.ts';
import { toList } from '../shape.ts';
import type { ListOut } from '../shape.ts';
import { loadProjectList, projectConfig } from './context.ts';
import type { Context } from './context.ts';

export async function listLists(ctx: Context): Promise<ListOut[]> {
  return (await loadProjectLists(ctx)).map(toList);
}

// The lists of the project, each loaded on its own to get its statuses: the listIds of the config, or the whole folder.
export async function loadProjectLists(ctx: Context): Promise<RawList[]> {
  const { folderId, listIds } = projectConfig(ctx);
  const detailed: RawList[] = [];
  if (listIds !== undefined) {
    for (const id of listIds) detailed.push(await loadProjectList(ctx, id));
    return detailed;
  }
  const { lists } = await ctx.client.request<{ lists: RawList[] }>('GET', `/folder/${folderId}/list`);
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
