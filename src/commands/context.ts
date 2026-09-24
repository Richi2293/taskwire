import type { Client } from '../client.ts';
import type { RawList, RawUser } from '../clickup-types.ts';
import type { ProjectConfig } from '../config.ts';
import { configError, usageError } from '../errors.ts';

export interface Context {
  client: Client;
  config: ProjectConfig | null;
  cwd: string;
}

const userIdCache = new WeakMap<Context, number>();

export function projectConfig(ctx: Context): ProjectConfig {
  if (ctx.config === null) throw configError('No .taskwire.json found for this project');
  return ctx.config;
}

export async function currentUserId(ctx: Context): Promise<number> {
  const cached = userIdCache.get(ctx);
  if (cached !== undefined) return cached;
  const { user } = await ctx.client.request<{ user: RawUser }>('GET', '/user');
  userIdCache.set(ctx, user.id);
  return user.id;
}

export async function resolveAssignee(ctx: Context, value: string): Promise<number> {
  if (value === 'me') return currentUserId(ctx);
  if (/^\d+$/.test(value)) return Number(value);
  throw usageError(`Invalid assignee "${value}"`, 'Use "me" or a numeric ClickUp user id');
}

// The workspace (ClickUp "team") that owns the given space. One workspace needs no search.
export async function findWorkspaceId(client: Client, spaceId: string): Promise<string> {
  const { teams } = await client.request<{ teams: { id: string; name: string }[] }>('GET', '/team');
  if (teams.length === 1) return teams[0].id;
  for (const team of teams) {
    const { spaces } = await client.request<{ spaces: { id: string }[] }>('GET', `/team/${team.id}/space`);
    if (spaces.some((space) => space.id === spaceId)) return team.id;
  }
  throw configError(`No ClickUp workspace contains space ${spaceId}`, 'Check the folder id with "taskwire folders"');
}

// Uses the workspaceId saved by init; older or hand-written configs fall back to a search.
export async function projectWorkspaceId(ctx: Context): Promise<string> {
  const config = projectConfig(ctx);
  if (config.workspaceId !== undefined) return config.workspaceId;
  const folder = await ctx.client.request<{ space: { id: string } }>('GET', `/folder/${config.folderId}`);
  return findWorkspaceId(ctx.client, folder.space.id);
}

export function matchStatus(list: RawList, wanted: string): string {
  const statuses = (list.statuses ?? []).map((s) => s.status);
  const found = statuses.find((status) => status.toLowerCase() === wanted.trim().toLowerCase());
  if (found === undefined) {
    throw usageError(`Status "${wanted}" does not exist in list "${list.name}"`, `Valid statuses: ${statuses.join(', ')}`);
  }
  return found;
}

export const PRIORITIES: Record<string, number> = { urgent: 1, high: 2, normal: 3, low: 4 };

export function parsePriority(value: string): number {
  const priority = PRIORITIES[value.toLowerCase()];
  if (priority === undefined) throw usageError(`Invalid priority "${value}"`, 'Use urgent, high, normal or low');
  return priority;
}
