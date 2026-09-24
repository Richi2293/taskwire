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

export async function singleTeamId(ctx: Context): Promise<string> {
  const { teams } = await ctx.client.request<{ teams: { id: string; name: string }[] }>('GET', '/team');
  if (teams.length !== 1) {
    throw usageError(`Found ${teams.length} ClickUp workspaces, expected one`, 'Pass --list to read a specific list');
  }
  return teams[0].id;
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
