import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { configError, usageError } from './errors.ts';

export const CONFIG_FILE = '.taskwire.json';

// ClickUp is the only task system supported today; the field keeps committed configs valid if others are added.
export const PROVIDERS = ['clickup'] as const;
export type Provider = (typeof PROVIDERS)[number];

export interface ProjectConfig {
  provider: Provider;
  folderId: string;
  defaultListId?: string;
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
  const { provider, folderId, defaultListId } = data as Record<string, unknown>;
  const checkedProvider = parseProvider(provider, path);
  if (typeof folderId !== 'string' || !NUMERIC_ID.test(folderId)) {
    throw configError(`${path}: "folderId" must be a numeric string`, 'Run "taskwire folders" to find the folder id');
  }
  if (defaultListId === undefined) return { provider: checkedProvider, folderId };
  if (typeof defaultListId !== 'string' || !NUMERIC_ID.test(defaultListId)) {
    throw configError(`${path}: "defaultListId" must be a numeric string`, 'Run "taskwire lists" to find the list id');
  }
  return { provider: checkedProvider, folderId, defaultListId };
}

function parseProvider(value: unknown, path: string): Provider {
  if (value === undefined) return 'clickup';
  const found = PROVIDERS.find((provider) => provider === value);
  if (found === undefined) {
    throw configError(`${path}: unsupported provider ${JSON.stringify(value)}`, `Supported providers: ${PROVIDERS.join(', ')}`);
  }
  return found;
}

export function writeConfig(dir: string, config: ProjectConfig, force: boolean): string {
  const path = join(dir, CONFIG_FILE);
  if (existsSync(path) && !force) {
    throw usageError(`${CONFIG_FILE} already exists in ${dir}`, 'Use --force to overwrite it');
  }
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  return path;
}
