import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { configError } from './errors.ts';

export interface ProjectEntry {
  // Absolute path of the project folder, the one with .taskwire.json.
  path: string;
  // Command that runs the project tests, from the project folder (for example "npm test").
  testCommand?: string;
  // Statuses the orchestrator picks tasks from; defaults to DEFAULT_START_STATUSES.
  startStatuses?: string[];
  // Tag that keeps the orchestrator away from a task; defaults to DEFAULT_BLOCK_TAG.
  blockTag?: string;
}

export interface OrchestratorConfig {
  // The taskwire command to run; defaults to "taskwire" on the PATH.
  taskwireCommand?: string;
  projects: ProjectEntry[];
}

export const DEFAULT_START_STATUSES = ['backlog', 'to do'];
export const DEFAULT_BLOCK_TAG = 'no-agent';

const CONFIG_FILE = 'config.json';

export function loadConfig(home: string): OrchestratorConfig {
  const path = join(home, CONFIG_FILE);
  if (!existsSync(path)) return { projects: [] };
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw configError(`${path} is not valid JSON`);
  }
  return parseConfig(data, path);
}

export function saveConfig(home: string, config: OrchestratorConfig): void {
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, CONFIG_FILE), `${JSON.stringify(config, null, 2)}\n`);
}

function parseConfig(data: unknown, path: string): OrchestratorConfig {
  const invalid = (reason: string) => configError(`${path}: ${reason}`, 'Fix the file, or remove it and add the projects again');
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw invalid('must contain a JSON object');
  const { taskwireCommand, projects } = data as Record<string, unknown>;
  if (!Array.isArray(projects)) throw invalid('"projects" must be an array');
  const config: OrchestratorConfig = { projects: projects.map((entry: unknown) => parseProject(entry, invalid)) };
  if (taskwireCommand !== undefined) {
    if (typeof taskwireCommand !== 'string' || taskwireCommand.trim() === '') throw invalid('"taskwireCommand" must be a non empty string');
    config.taskwireCommand = taskwireCommand;
  }
  return config;
}

function parseProject(entry: unknown, invalid: (reason: string) => Error): ProjectEntry {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw invalid('each project must be an object');
  const { path, testCommand, startStatuses, blockTag } = entry as Record<string, unknown>;
  if (typeof path !== 'string' || !path.startsWith('/')) throw invalid('each project needs an absolute "path"');
  const project: ProjectEntry = { path };
  if (testCommand !== undefined) project.testCommand = text(testCommand, `"testCommand" of ${path}`, invalid);
  if (blockTag !== undefined) project.blockTag = text(blockTag, `"blockTag" of ${path}`, invalid).toLowerCase();
  if (startStatuses !== undefined) {
    if (!Array.isArray(startStatuses) || startStatuses.length === 0) throw invalid(`"startStatuses" of ${path} must be a non empty array`);
    project.startStatuses = startStatuses.map((status: unknown) => text(status, `"startStatuses" of ${path}`, invalid));
  }
  return project;
}

function text(value: unknown, what: string, invalid: (reason: string) => Error): string {
  if (typeof value !== 'string' || value.trim() === '') throw invalid(`${what} must be a non empty string`);
  return value;
}
