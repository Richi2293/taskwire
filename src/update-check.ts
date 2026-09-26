import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FetchFn } from './client.ts';
import type { PackageInfo } from './package-info.ts';

export interface UpdateNotice {
  latest: string;
  command: string;
}

export interface UpdateCheckDeps {
  fetch: FetchFn;
  now: () => number;
  env: Record<string, string | undefined>;
}

interface CacheEntry {
  checkedAt: number;
  // null when the last check failed, so an offline machine does not retry on every run.
  latest: string | null;
}

const REGISTRY = 'https://registry.npmjs.org';
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 1500;

// Asks npm for the latest version at most once a day. Every failure means "no notice": the check must never
// slow down or break the command that runs it.
export async function checkForUpdate(deps: UpdateCheckDeps, pkg: PackageInfo): Promise<UpdateNotice | null> {
  if (deps.env.TASKWIRE_NO_UPDATE_CHECK) return null;
  const file = cacheFile(deps.env);
  // Without a cache the registry would be asked on every run, so there is no check at all.
  if (file === null) return null;

  let entry = readCache(file);
  if (entry === null || deps.now() - entry.checkedAt >= CHECK_EVERY_MS) {
    entry = { checkedAt: deps.now(), latest: await fetchLatest(deps.fetch, pkg.name) };
    writeCache(file, entry);
  }
  if (entry.latest === null || !isNewer(entry.latest, pkg.version)) return null;
  return { latest: entry.latest, command: `npm i -g ${pkg.name}@latest` };
}

// Only plain x.y.z versions are compared; a pre-release is never offered as an update.
export function isNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (a === null || b === null) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

function parseVersion(version: string): number[] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return match === null ? null : match.slice(1).map(Number);
}

function cacheFile(env: Record<string, string | undefined>): string | null {
  const base = env.XDG_CACHE_HOME || (env.HOME ? join(env.HOME, '.cache') : null);
  return base === null ? null : join(base, 'taskwire', 'update-check.json');
}

async function fetchLatest(fetch: FetchFn, name: string): Promise<string | null> {
  try {
    const url = `${REGISTRY}/-/package/${name.replace('/', '%2f')}/dist-tags`;
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return null;
    const tags = (await response.json()) as { latest?: unknown };
    return typeof tags.latest === 'string' ? tags.latest : null;
  } catch {
    return null;
  }
}

function readCache(file: string): CacheEntry | null {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8')) as { checkedAt?: unknown; latest?: unknown };
    if (typeof data.checkedAt !== 'number') return null;
    return { checkedAt: data.checkedAt, latest: typeof data.latest === 'string' ? data.latest : null };
  } catch {
    return null;
  }
}

function writeCache(file: string, entry: CacheEntry): void {
  try {
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, JSON.stringify(entry));
  } catch {
    // A read-only home only means the registry is asked again next time.
  }
}
