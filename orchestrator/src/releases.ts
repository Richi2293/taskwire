import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Where the release of staging to production stands for a project with level main; the dashboard shows it.
export interface ReleaseState {
  state: 'waiting-test' | 'waiting-ci' | 'blocked' | 'released';
  reason: string;
  pr: number | null;
  // The staging commit the release pull request was at, and when the orchestrator first saw it: the settle time counts from there.
  head: string | null;
  headSeenAt: string | null;
  at: string;
}

const RELEASES_FILE = 'releases.json';

// A broken file reads as no state: the next tick writes it again.
export function readReleases(home: string): Record<string, ReleaseState> {
  const path = join(home, RELEASES_FILE);
  if (!existsSync(path)) return {};
  try {
    const data: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as Record<string, ReleaseState>) : {};
  } catch {
    return {};
  }
}

// Sets the state of a project, or removes it with null. Written to a temporary file first, so a stop never leaves half a file.
export function writeRelease(home: string, project: string, state: ReleaseState | null): void {
  const releases = readReleases(home);
  if (state === null) delete releases[project];
  else releases[project] = state;
  mkdirSync(home, { recursive: true });
  const file = join(home, RELEASES_FILE);
  writeFileSync(`${file}.tmp`, `${JSON.stringify(releases, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
}
