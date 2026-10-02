import { existsSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { expandHome, loadConfig, saveConfig } from './config.ts';
import type { MergeLevel, OrchestratorConfig, ProjectEntry } from './config.ts';
import { configError, usageError } from './errors.ts';
import { readClaims } from './state.ts';
import type { RunTaskwire } from './taskwire.ts';

export interface FollowDeps {
  home: string;
  runTaskwire: RunTaskwire;
}

// Adds a project set up with taskwire to the ones the orchestrator follows. Used by "add" and by the dashboard.
export async function followProject(deps: FollowDeps, folder: string, testCommand?: string): Promise<ProjectEntry> {
  const expanded = expandHome(folder);
  if (!expanded.startsWith('/')) throw usageError(`${folder} is not an absolute path`, 'Write the full path of the project folder, for example /Users/jane/code/website');
  const path = resolve(expanded);
  if (!existsSync(join(path, '.taskwire.json'))) {
    throw usageError(`${path} has no .taskwire.json`, 'Set the project up first: run "taskwire setup" in it');
  }
  if (testCommand !== undefined && testCommand.trim() === '') throw usageError('The test command cannot be empty');
  const config = loadConfig(deps.home);
  if (config.projects.some((project) => project.path === path)) throw usageError(`${path} is already followed`);
  try {
    await deps.runTaskwire(['conventions'], path);
  } catch (error) {
    throw configError(`taskwire does not work in ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const project: ProjectEntry = { path };
  if (testCommand !== undefined) project.testCommand = testCommand.trim();
  // Read again: the config may have changed while taskwire was checked.
  const latest = loadConfig(deps.home);
  if (latest.projects.some((entry) => entry.path === path)) throw usageError(`${path} is already followed`);
  latest.projects.push(project);
  saveConfig(deps.home, latest);
  return project;
}

// Stops following a project. Only the config changes: the folder, its worktrees and its tasks stay as they are.
export function unfollowProject(home: string, folder: string): void {
  const path = resolve(expandHome(folder));
  const config = loadConfig(home);
  if (!config.projects.some((project) => project.path === path)) throw usageError(`${path} is not followed`);
  if (Object.values(readClaims(home)).some((claim) => claim.project === path)) {
    throw usageError(`An agent is working in ${path}`, 'Wait until it finishes, then try again');
  }
  config.projects = config.projects.filter((project) => project.path !== path);
  saveConfig(home, config);
}

// Turns the agents of a followed project on or off. Off keeps the project followed: its waiting tasks still show on the dashboard.
// An agent already at work finishes its task. On is the default, so it removes the field.
export function setProjectAgents(home: string, folder: string, on: boolean): void {
  const path = resolve(expandHome(folder));
  const config = loadConfig(home);
  const project = config.projects.find((entry) => entry.path === path);
  if (project === undefined) throw usageError(`${path} is not followed`);
  if (on) delete project.agents;
  else project.agents = false;
  saveConfig(home, config);
}

// Sets the group of a followed project: the product it belongs to, with the other projects of its task list.
// An empty value removes it. The area is not here: it lives in the project's .taskwire.json.
export function setProjectGroup(home: string, folder: string, value: string): void {
  const path = resolve(expandHome(folder));
  const config = loadConfig(home);
  const project = config.projects.find((entry) => entry.path === path);
  if (project === undefined) throw usageError(`${path} is not followed`);
  const group = value.trim();
  if (group.length > MAX_GROUP) throw usageError(`The group must be at most ${MAX_GROUP} characters`);
  if (group === '') delete project.group;
  else project.group = group;
  saveConfig(home, config);
}

const MAX_GROUP = 100;

// Sets who merges the work of a followed project. PR only is the default, so it removes the field.
export function setProjectMerge(home: string, folder: string, level: MergeLevel): void {
  const path = resolve(expandHome(folder));
  const config = loadConfig(home);
  const project = config.projects.find((entry) => entry.path === path);
  if (project === undefined) throw usageError(`${path} is not followed`);
  if (level === 'none') delete project.merge;
  else project.merge = level;
  saveConfig(home, config);
}

export interface DiscoverOptions {
  roots: string[];
  // Paths already followed, left out of the result.
  followed: string[];
  maxFolders?: number;
}

export interface Discovered {
  roots: string[];
  projects: { path: string; name: string }[];
  // True when the search stopped at maxFolders, so some projects may be missing.
  truncated: boolean;
}

// How deep under a root a project may be: ~/code/website is 1, ~/code/clients/acme/shop is 3.
const MAX_DEPTH = 3;
const MAX_FOLDERS = 5000;
const SKIPPED = new Set(['node_modules', 'Library']);

// Looks for folders with a .taskwire.json under the roots. It does not look inside a project,
// nor in hidden folders or node_modules, and stops after maxFolders folders so it stays quick.
export function discoverProjects(options: DiscoverOptions): Discovered {
  const followed = new Set(options.followed);
  const limit = options.maxFolders ?? MAX_FOLDERS;
  const found = new Map<string, string>();
  let visited = 0;
  let truncated = false;

  const walk = (folder: string, depth: number): void => {
    if (truncated) return;
    if (visited >= limit) {
      truncated = true;
      return;
    }
    visited += 1;
    if (depth > 0 && existsSync(join(folder, '.taskwire.json'))) {
      if (!followed.has(folder)) found.set(folder, basename(folder));
      return;
    }
    if (depth === MAX_DEPTH) return;
    let names: string[];
    try {
      names = readdirSync(folder, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !SKIPPED.has(entry.name))
        .map((entry) => entry.name)
        .sort();
    } catch {
      // A folder we may not read (permissions) is simply skipped.
      return;
    }
    for (const name of names) walk(join(folder, name), depth + 1);
  };

  for (const root of options.roots) walk(root, 0);
  const projects = [...found].map(([path, name]) => ({ path, name })).sort((a, b) => a.path.localeCompare(b.path));
  return { roots: options.roots, projects, truncated };
}

// Where the dashboard looks for projects: projectRoots when set, otherwise the folders that hold the projects already followed.
// The whole home folder is never searched: on macOS that would ask for access to Documents, Desktop and Downloads.
export function projectSearchRoots(config: Pick<OrchestratorConfig, 'projects' | 'projectRoots'>): string[] {
  if (config.projectRoots !== undefined) return config.projectRoots;
  return [...new Set(config.projects.map((project) => dirname(project.path)))];
}
