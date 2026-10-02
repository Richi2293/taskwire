import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { normalizeArea } from './area.ts';
import { configError } from './errors.ts';

// The groups of this machine: the projects that share a task list, and the areas without code of that list.
// They live outside the repositories and outside the task system, since they hold local paths.
export interface GroupArea {
  description: string;
  // Absolute path of the repository with the code of the area; missing for an area without code.
  path?: string;
}

export interface Group {
  areas: Record<string, GroupArea>;
}

export interface GroupsFile {
  groups: Record<string, Group>;
}

export const GROUPS_FILE = 'groups.json';

// TASKWIRE_HOME, else the XDG config folder, else ~/.config; null when none is set.
export function groupsFilePath(env: Record<string, string | undefined>): string | null {
  if (env.TASKWIRE_HOME) return join(env.TASKWIRE_HOME, GROUPS_FILE);
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, 'taskwire', GROUPS_FILE);
  if (env.HOME) return join(env.HOME, '.config', 'taskwire', GROUPS_FILE);
  return null;
}

export function readGroups(path: string): GroupsFile {
  if (!existsSync(path)) return { groups: {} };
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw configError(`${path} is not valid JSON`, 'Fix the file or remove it to start again');
  }
  const invalid = (reason: string) => configError(`${path}: ${reason}`, 'Example: {"groups": {"acme": {"areas": {"infra": {"description": "Servers"}}}}}');
  if (!isRecord(data) || !isRecord(data.groups)) throw invalid('"groups" must be an object');
  const groups: Record<string, Group> = {};
  for (const [name, group] of Object.entries(data.groups)) {
    if (parseName(name) !== name) throw invalid(`"${name}" is not a valid group name`);
    if (!isRecord(group) || !isRecord(group.areas)) throw invalid(`group "${name}" must have an "areas" object`);
    const areas: Record<string, GroupArea> = {};
    for (const [areaName, area] of Object.entries(group.areas)) {
      if (parseName(areaName) !== areaName) throw invalid(`"${areaName}" is not a valid area name`);
      const description: unknown = isRecord(area) ? area.description : undefined;
      const areaPath: unknown = isRecord(area) ? area.path : undefined;
      if (typeof description !== 'string') throw invalid(`area "${areaName}" must have a "description"`);
      if (areaPath === undefined) areas[areaName] = { description };
      else if (typeof areaPath === 'string') areas[areaName] = { description, path: areaPath };
      else throw invalid(`the "path" of area "${areaName}" must be a string`);
    }
    groups[name] = { areas };
  }
  return { groups };
}

// Own keys only, so that names such as "constructor" are not taken for areas or groups.
export function hasKey(record: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(record, key);
}

export function writeGroups(path: string, data: GroupsFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

// The group and the area whose path is dir, compared after resolving symbolic links.
export function findGroupOf(data: GroupsFile, dir: string): { name: string; group: Group; area: string } | null {
  const wanted = realPath(dir);
  for (const [name, group] of Object.entries(data.groups)) {
    for (const [area, entry] of Object.entries(group.areas)) {
      if (entry.path !== undefined && realPath(entry.path) === wanted) return { name, group, area };
    }
  }
  return null;
}

export function realPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

// Group and area names follow the same rule: one lowercase word. "none" is kept for "--area none".
export function parseName(value: string): string | null {
  const name = normalizeArea(value);
  return name === 'none' ? null : name;
}

export const GROUP_NAME_HINT = 'Use one lowercase word, such as "acme"';

// An existing area so close to name that it is probably the same one, or null.
// Close means: one or two letters apart, one starting or ending with the other, or an abbreviation of the other.
export function similarArea(names: string[], name: string): string | null {
  const wanted = compact(name);
  for (const existing of names) {
    const other = compact(existing);
    if (other === wanted) return existing;
    const [shorter, longer] = wanted.length <= other.length ? [wanted, other] : [other, wanted];
    // Short names one letter apart are often different words, such as "api" and "app".
    const maxEdits = shorter.length >= 6 ? 2 : shorter.length >= 4 ? 1 : 0;
    if (editDistance(shorter, longer) <= maxEdits) return existing;
    if (shorter.length >= 3 && (longer.startsWith(shorter) || longer.endsWith(shorter))) return existing;
    if (shorter.length >= 3 && shorter[0] === longer[0] && isSubsequence(shorter, longer)) return existing;
  }
  return null;
}

function compact(name: string): string {
  return name.replace(/[-_]/g, '');
}

function isSubsequence(short: string, long: string): boolean {
  let index = 0;
  for (const char of long) {
    if (char === short[index]) index++;
    if (index === short.length) return true;
  }
  return false;
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current.push(Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost));
    }
    previous = current;
  }
  return previous[b.length];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
