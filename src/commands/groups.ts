import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { CommandInput } from '../args.ts';
import { flag, onePositional, optString, reqString } from '../args.ts';
import { readArea } from '../config.ts';
import { configError, usageError } from '../errors.ts';
import { GROUP_NAME_HINT, findGroupOf, hasKey, parseName, readGroups, realPath, similarArea, writeGroups } from '../groups.ts';
import { AREA_HINT } from '../area.ts';
import { projectConfig } from './context.ts';
import type { Context } from './context.ts';
import { NO_GROUP_HINT, groupOut, locateGroup, projectGroup } from './group-context.ts';
import type { AreaOut, GroupOut, LocatedGroup } from './group-context.ts';
import { listTasks } from './tasks-read.ts';

// Records a new group on this machine, with the area of this project as its first area.
export function initGroup(ctx: Context, input: CommandInput): GroupOut {
  const config = projectConfig(ctx);
  const value = onePositional(input, 'group name');
  const name = parseName(value);
  if (name === null) throw usageError(`Invalid group name "${value}"`, GROUP_NAME_HINT);
  const description = reqString(input.values, 'description');
  if (config.area === undefined) throw usageError('This project has no area', 'Set it first with "taskwire area set <tag>"');
  if (ctx.groupsPath === null || ctx.configPath === null) {
    throw configError('No home folder for the groups file', 'Set HOME, or TASKWIRE_HOME to the folder of the groups file');
  }
  const located = locateGroup(ctx);
  if (located !== null) throw usageError(`This project is already in the group "${located.name}"`, 'Run "taskwire group" to see it');
  const data = readGroups(ctx.groupsPath);
  if (hasKey(data.groups, name)) {
    throw usageError(`The group "${name}" already exists`, `From a project of that group, add this one with "taskwire area add ${config.area} --path <dir> --description <text>"`);
  }
  const path = realPath(dirname(ctx.configPath));
  data.groups[name] = { areas: { [config.area]: { description: description.trim(), path } } };
  writeGroups(ctx.groupsPath, data);
  return { name, areas: [{ name: config.area, description: description.trim(), path, own: true }] };
}

export function showGroup(ctx: Context): GroupOut | null {
  const located = projectGroup(ctx);
  return located === null ? null : groupOut(located);
}

// Adds an area to the group of this project, or updates its description and path.
export function addArea(ctx: Context, input: CommandInput): AreaOut {
  const located = requireGroup(ctx);
  const value = onePositional(input, 'area');
  const name = parseName(value);
  if (name === null) throw usageError(`Invalid area "${value}"`, AREA_HINT);
  const description = reqString(input.values, 'description').trim();
  const pathValue = optString(input.values, 'path');
  const existing = hasKey(located.group.areas, name) ? located.group.areas[name] : undefined;

  if (existing === undefined && !flag(input.values, 'force')) {
    const similar = similarArea(Object.keys(located.group.areas), name);
    if (similar !== null) {
      throw usageError(`The area "${similar}" already exists and is close to "${name}"`, `Use "${similar}", or pass --force if "${name}" is really a different area`);
    }
  }
  const path = pathValue === undefined ? existing?.path : checkAreaPath(ctx, located, name, pathValue);
  located.group.areas[name] = path === undefined ? { description } : { description, path };
  writeGroups(located.path, located.data);
  return { name, description, path: path ?? null, own: name === located.area };
}

// The real path of the repository of an area: a folder that no other area uses, whose project has no other area.
function checkAreaPath(ctx: Context, located: LocatedGroup, name: string, value: string): string {
  const path = realPath(resolve(ctx.cwd, value));
  if (!existsSync(path) || !statSync(path).isDirectory()) throw usageError(`No folder at ${path}`, 'Pass the folder of the repository with the code of the area');
  if (name === located.area && path !== realPath(located.group.areas[name].path ?? '')) {
    throw usageError(`"${name}" is the area of this project, so its path is this project`);
  }
  const owner = findGroupOf(located.data, path);
  if (owner !== null && !(owner.name === located.name && owner.area === name)) {
    throw usageError(`${path} is already the "${owner.area}" area of the group "${owner.name}"`);
  }
  const projectArea = readArea(path);
  if (projectArea !== undefined && projectArea !== name) {
    throw usageError(`The project in ${path} is the "${projectArea}" area`, `Use "${projectArea}", or change it there with "taskwire area set ${name}"`);
  }
  if (projectArea === undefined) {
    ctx.warn(`The project in ${path} has no area yet`, `Run "taskwire area set ${name}" in ${path}`);
  }
  return path;
}

// Takes an area out of the group; its tasks keep their tag.
export function removeArea(ctx: Context, input: CommandInput): { name: string; removed: true } {
  const located = requireGroup(ctx);
  const value = onePositional(input, 'area');
  const name = parseName(value) ?? value;
  if (!hasKey(located.group.areas, name)) throw usageError(`The group "${located.name}" has no area "${value}"`, 'Run "taskwire areas" to see them');
  if (name === located.area) throw usageError(`"${name}" is the area of this project`, 'Run this command from another project of the group');
  delete located.group.areas[name];
  writeGroups(located.path, located.data);
  return { name, removed: true };
}

export interface AreaCountOut {
  name: string;
  description: string | null;
  path: string | null;
  own: boolean;
  tasks: number;
}

export interface AreasOut {
  group: string | null;
  areas: AreaCountOut[];
  // The tasks with no area of the group; null without a group, since taskwire then knows only one area.
  noArea: number | null;
}

// The areas of the group with their number of tasks, so an agent picks an area and finds the tasks to sort.
export async function listAreas(ctx: Context, input: CommandInput): Promise<AreasOut> {
  const located = projectGroup(ctx);
  const { area } = projectConfig(ctx);
  const areas: Omit<AreaCountOut, 'tasks'>[] = located !== null
    ? groupOut(located).areas
    : area === undefined ? [] : [{ name: area, description: null, path: null, own: true }];
  const values = { 'all-areas': true, 'include-closed': flag(input.values, 'include-closed') };
  const tasks = await listTasks(ctx, { positionals: [], values }, 'Some counts may be low: they come from the tasks read so far');
  const names = areas.map((entry) => entry.name);
  return {
    group: located?.name ?? null,
    areas: areas.map((entry) => ({ ...entry, tasks: tasks.filter((task) => task.tags.includes(entry.name)).length })),
    noArea: located === null ? null : tasks.filter((task) => !task.tags.some((tag) => names.includes(tag))).length,
  };
}

function requireGroup(ctx: Context): LocatedGroup {
  const located = projectGroup(ctx);
  if (located === null) throw usageError('This project is in no group', NO_GROUP_HINT);
  return located;
}
