import type { CommandInput } from '../args.ts';
import { reqString } from '../args.ts';
import type { RawList } from '../clickup-types.ts';
import { toList } from '../shape.ts';
import type { ListOut } from '../shape.ts';
import { projectConfig } from './context.ts';
import type { Context } from './context.ts';

export async function listLists(ctx: Context): Promise<ListOut[]> {
  return (await loadFolderLists(ctx)).map(toList);
}

// The lists of the project's folder, each loaded on its own to get its statuses.
export async function loadFolderLists(ctx: Context): Promise<RawList[]> {
  const { folderId } = projectConfig(ctx);
  const { lists } = await ctx.client.request<{ lists: RawList[] }>('GET', `/folder/${folderId}/list`);
  const detailed: RawList[] = [];
  for (const list of lists) {
    detailed.push(await ctx.client.request<RawList>('GET', `/list/${list.id}`));
  }
  return detailed;
}

export async function createList(ctx: Context, input: CommandInput): Promise<ListOut> {
  const { folderId } = projectConfig(ctx);
  const name = reqString(input.values, 'name');
  const list = await ctx.client.request<RawList>('POST', `/folder/${folderId}/list`, { body: { name } });
  return toList(list);
}
