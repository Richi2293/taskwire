import { dirname } from 'node:path';
import { AREA_HINT, normalizeArea } from '../area.ts';
import { EXIT, TaskwireError, configError, usageError } from '../errors.ts';
import { findGroupOf, hasKey, readGroups } from '../groups.ts';
import type { Group, GroupsFile } from '../groups.ts';
import { projectConfig } from './context.ts';
import type { Context } from './context.ts';

export const NO_GROUP_HINT = 'Record the group first with "taskwire group init <name> --description <text>"';

export interface AreaOut {
  name: string;
  description: string;
  path: string | null;
  // The area of this project.
  own: boolean;
}

export interface GroupOut {
  name: string;
  areas: AreaOut[];
}

export interface LocatedGroup {
  path: string;
  data: GroupsFile;
  name: string;
  group: Group;
  // The area whose path is this project.
  area: string;
}

// The group whose areas include this project, read as it is: callers that can repair a mismatch use it directly.
export function locateGroup(ctx: Context): LocatedGroup | null {
  if (ctx.groupsPath === null || ctx.configPath === null) return null;
  const data = readGroups(ctx.groupsPath);
  const found = findGroupOf(data, dirname(ctx.configPath));
  return found === null ? null : { path: ctx.groupsPath, data, ...found };
}

// The group of this project, checked against the area in .taskwire.json; null when the project is in no group.
export function projectGroup(ctx: Context): LocatedGroup | null {
  const located = locateGroup(ctx);
  if (located === null) return null;
  const { area } = projectConfig(ctx);
  if (area !== located.area) {
    throw configError(
      `This project is the "${located.area}" area of the group "${located.name}" in ${located.path}, but .taskwire.json has ${area === undefined ? 'no area' : `"${area}"`}`,
      `Run "taskwire area set ${located.area}"`,
    );
  }
  return located;
}

// The group for commands that only show it (rules, project, tags): a broken groups file or a mismatched
// area is a warning there, so that it does not stop an agent at the start of a session.
export function shownGroup(ctx: Context): LocatedGroup | null {
  return warnOnConfigError(ctx, () => projectGroup(ctx));
}

// Turns a configuration error of read into a warning and null.
export function warnOnConfigError(ctx: Context, read: () => LocatedGroup | null): LocatedGroup | null {
  try {
    return read();
  } catch (error) {
    if (!(error instanceof TaskwireError) || error.exitCode !== EXIT.config) throw error;
    ctx.warn(error.message, error.hint);
    return null;
  }
}

export function groupOut(located: LocatedGroup): GroupOut {
  const areas = Object.entries(located.group.areas).map(([name, entry]) => ({
    name,
    description: entry.description,
    path: entry.path ?? null,
    own: name === located.area,
  }));
  return { name: located.name, areas };
}

// The areas taskwire knows for this project: those of its group, or only its own; null when it knows none.
export function knownAreas(ctx: Context): string[] | null {
  const located = shownGroup(ctx);
  if (located !== null) return Object.keys(located.group.areas);
  const { area } = projectConfig(ctx);
  return area === undefined ? null : [area];
}

// The areas given with --area, in lowercase. In a group they must be areas of the group, so that a typo
// or a new area does not slip in: a new one is added first with "taskwire area add".
export function readAreas(ctx: Context, values: string[]): string[] {
  const located = projectGroup(ctx);
  const areas: string[] = [];
  for (const value of values) {
    const area = normalizeArea(value);
    if (area === null) throw usageError(`Invalid --area "${value}"`, AREA_HINT);
    if (located !== null && !hasKey(located.group.areas, area)) {
      throw usageError(
        `The group "${located.name}" has no area "${area}"`,
        'Run "taskwire areas" to see them, or add one with "taskwire area add <name> --description <text>"',
      );
    }
    if (!areas.includes(area)) areas.push(area);
  }
  return areas;
}
