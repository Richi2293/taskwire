import { dirname } from 'node:path';
import type { CommandInput } from '../args.ts';
import { onePositional } from '../args.ts';
import { AREA_HINT, normalizeArea } from '../area.ts';
import { writeConfig } from '../config.ts';
import type { ProjectConfig, Provider } from '../config.ts';
import { configError, usageError } from '../errors.ts';
import { hasKey, writeGroups } from '../groups.ts';
import type { GroupArea } from '../groups.ts';
import { projectConfig } from './context.ts';
import type { Context } from './context.ts';
import { locateGroup, shownGroup, warnOnConfigError } from './group-context.ts';
import type { LocatedGroup } from './group-context.ts';

export interface ProjectOut {
  provider: Provider;
  account: string | null;
  workspaceId: string | null;
  folderId: string;
  listIds: string[] | null;
  defaultListId: string | null;
  area: string | null;
  // The group of projects this one belongs to on this machine (see "taskwire group"), or null.
  group: string | null;
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
    group: shownGroup(ctx)?.name ?? null,
  };
}

// Sets or removes ("none") the area in .taskwire.json, keeping the rest of the config.
// In a group, the area keeps its place there under the new name, so that the two stay the same.
export function setArea(ctx: Context, input: CommandInput): { path: string; area: string | null } {
  const config = projectConfig(ctx);
  if (ctx.configPath === null) throw configError('No .taskwire.json found for this project');
  const value = onePositional(input, 'area');
  const remove = value.trim().toLowerCase() === 'none';
  const area = remove ? null : normalizeArea(value);
  if (!remove && area === null) throw usageError(`Invalid area "${value}"`, `${AREA_HINT}, or "none" to remove it`);
  // The group as it is, so that a mismatched area can be repaired; a broken groups file only warns.
  const located = warnOnConfigError(ctx, () => locateGroup(ctx));
  if (located !== null && area !== located.area) renameGroupArea(located, area);
  const next: ProjectConfig = { ...config };
  if (area === null) delete next.area;
  else next.area = area;
  const path = writeConfig(dirname(ctx.configPath), next, true);
  return { path, area };
}

function renameGroupArea(located: LocatedGroup, area: string | null): void {
  if (area === null) {
    throw usageError(`This project is the "${located.area}" area of the group "${located.name}"`, 'An area of a group cannot be removed, only renamed');
  }
  if (hasKey(located.group.areas, area)) {
    throw usageError(`The group "${located.name}" already has an area "${area}"`, 'Pick another name');
  }
  // Rebuilt in the same order, so the renamed area keeps its place.
  located.group.areas = Object.fromEntries(
    Object.entries(located.group.areas).map(([name, entry]): [string, GroupArea] => [name === located.area ? area : name, entry]),
  );
  located.data.groups[located.name] = located.group;
  writeGroups(located.path, located.data);
}
