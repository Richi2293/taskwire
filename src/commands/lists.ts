import type { CommandInput } from '../args.ts';
import { reqString } from '../args.ts';
import type { RawList } from '../clickup-types.ts';
import { toList } from '../shape.ts';
import type { ListOut } from '../shape.ts';
import { projectConfig } from './context.ts';
import type { Context } from './context.ts';

export async function listLists(ctx: Context): Promise<ListOut[]> {
  const { folderId } = projectConfig(ctx);
  const { lists } = await ctx.client.request<{ lists: RawList[] }>('GET', `/folder/${folderId}/list`);
  const detailed: ListOut[] = [];
  for (const list of lists) {
    detailed.push(toList(await ctx.client.request<RawList>('GET', `/list/${list.id}`)));
  }
  return detailed;
}

export async function createList(ctx: Context, input: CommandInput): Promise<ListOut> {
  const { folderId } = projectConfig(ctx);
  const name = reqString(input.values, 'name');
  const list = await ctx.client.request<RawList>('POST', `/folder/${folderId}/list`, { body: { name } });
  return toList(list);
}
