import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { configError, usageError } from './errors.ts';

export const CONFIG_FILE = '.taskwire.json';

// ClickUp is the only task system supported today; the field keeps committed configs valid if others are added.
export const PROVIDERS = ['clickup'] as const;
export type Provider = (typeof PROVIDERS)[number];

// How agents should write tasks in this project (language, style). Guidance only: the CLI does not enforce it.
export interface TaskConventions {
  language?: string;
  instructions?: string;
}

export interface ProjectConfig {
  provider: Provider;
  workspaceId?: string;
  folderId: string;
  defaultListId?: string;
  conventions?: TaskConventions;
}

const NUMERIC_ID = /^\d+$/;

export function findConfig(startDir: string): { path: string; config: ProjectConfig } | null {
  let dir = startDir;
  while (true) {
    const candidate = join(dir, CONFIG_FILE);
    if (existsSync(candidate)) {
      return { path: candidate, config: parseConfig(readFileSync(candidate, 'utf8'), candidate) };
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function parseConfig(text: string, path: string): ProjectConfig {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw configError(`${path} is not valid JSON`);
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw configError(`${path} must contain a JSON object`);
  }
  const { provider, workspaceId, folderId, defaultListId, conventions } = data as Record<string, unknown>;
  const config: ProjectConfig = {
    provider: parseProvider(provider, path),
    folderId: checkId(folderId, 'folderId', path, 'Run "taskwire folders" to find the folder id'),
  };
  if (workspaceId !== undefined) {
    config.workspaceId = checkId(workspaceId, 'workspaceId', path, 'Run "taskwire init --force" to rewrite it');
  }
  if (defaultListId !== undefined) {
    config.defaultListId = checkId(defaultListId, 'defaultListId', path, 'Run "taskwire lists" to find the list id');
  }
  if (conventions !== undefined) {
    const parsed = parseConventions(conventions, path);
    if (Object.keys(parsed).length > 0) config.conventions = parsed;
  }
  return config;
}

function parseConventions(value: unknown, path: string): TaskConventions {
  const hint = 'Example: "conventions": { "language": "English", "instructions": "..." }';
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw configError(`${path}: "conventions" must be an object`, hint);
  }
  const { language, instructions } = value as Record<string, unknown>;
  const conventions: TaskConventions = {};
  if (language !== undefined) conventions.language = checkText(language, 'conventions.language', path, hint);
  if (instructions !== undefined) conventions.instructions = checkText(instructions, 'conventions.instructions', path, hint);
  return conventions;
}

function checkText(value: unknown, key: string, path: string, hint: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw configError(`${path}: "${key}" must be a non empty string`, hint);
  }
  return value;
}

function checkId(value: unknown, key: string, path: string, hint: string): string {
  if (typeof value !== 'string' || !NUMERIC_ID.test(value)) {
    throw configError(`${path}: "${key}" must be a numeric string`, hint);
  }
  return value;
}

function parseProvider(value: unknown, path: string): Provider {
  if (value === undefined) return 'clickup';
  const found = PROVIDERS.find((provider) => provider === value);
  if (found === undefined) {
    throw configError(`${path}: unsupported provider ${JSON.stringify(value)}`, `Supported providers: ${PROVIDERS.join(', ')}`);
  }
  return found;
}

// Conventions from the config file in dir, read leniently so that "init --force" can repair a broken file without losing them.
export function readConventions(dir: string): TaskConventions | undefined {
  const path = join(dir, CONFIG_FILE);
  if (!existsSync(path)) return undefined;
  try {
    const data: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof data !== 'object' || data === null || !('conventions' in data)) return undefined;
    const conventions = parseConventions(data.conventions, path);
    return Object.keys(conventions).length > 0 ? conventions : undefined;
  } catch {
    return undefined;
  }
}

export function writeConfig(dir: string, config: ProjectConfig, force: boolean): string {
  const path = join(dir, CONFIG_FILE);
  if (existsSync(path) && !force) {
    throw usageError(`${CONFIG_FILE} already exists in ${dir}`, 'Use --force to overwrite it');
  }
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  return path;
}
