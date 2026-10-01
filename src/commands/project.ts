import { dirname } from 'node:path';
import type { CommandInput } from '../args.ts';
import { onePositional } from '../args.ts';
import { AREA_HINT, normalizeArea } from '../area.ts';
import { writeConfig } from '../config.ts';
import type { ProjectConfig, Provider } from '../config.ts';
import { configError, usageError } from '../errors.ts';
import { projectConfig } from './context.ts';
import type { Context } from './context.ts';

export interface ProjectOut {
  provider: Provider;
  account: string | null;
  workspaceId: string | null;
  folderId: string;
  listIds: string[] | null;
  defaultListId: string | null;
  area: string | null;
}

// The part of the task system this project uses, for tools that work on several projects. Never the token.
export function projectInfo(ctx: Context): ProjectOut {
  const config = projectConfig(ctx);
  return {
    provider: config.provider,
    account: config.account ?? null,
    workspaceId: config.workspaceId ?? null,
    folderId: config.folderId,
    listIds: config.listIds ?? null,
    defaultListId: config.defaultListId ?? null,
    area: config.area ?? null,
  };
}

// Sets or removes ("none") the area in .taskwire.json, keeping the rest of the config.
export function setArea(ctx: Context, input: CommandInput): { path: string; area: string | null } {
  const config = projectConfig(ctx);
  if (ctx.configPath === null) throw configError('No .taskwire.json found for this project');
  const value = onePositional(input, 'area');
  const remove = value.trim().toLowerCase() === 'none';
  const area = remove ? null : normalizeArea(value);
  if (!remove && area === null) throw usageError(`Invalid area "${value}"`, `${AREA_HINT}, or "none" to remove it`);
  const next: ProjectConfig = { ...config };
  if (area === null) delete next.area;
  else next.area = area;
  const path = writeConfig(dirname(ctx.configPath), next, true);
  return { path, area };
}
