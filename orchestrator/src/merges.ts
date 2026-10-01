import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// A verified task whose pull request the orchestrator merges into staging once its CI is green.
export interface PendingMerge {
  project: string;
  task: string;
  name: string;
  branch: string;
  pr: number;
  url: string;
  // The commit the tests and the verifier checked: only this one may be merged.
  sha: string;
  queuedAt: string;
}

const MERGES_FILE = 'merges.json';

// A broken file reads as an empty queue: the tasks still wait for review, so a person sees them.
export function readMerges(home: string): PendingMerge[] {
  const path = join(home, MERGES_FILE);
  if (!existsSync(path)) return [];
  try {
    const data: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(data) ? (data as PendingMerge[]) : [];
  } catch {
    return [];
  }
}

// Written to a temporary file first, so a stop in the middle never leaves half a file.
export function writeMerges(home: string, merges: PendingMerge[]): void {
  mkdirSync(home, { recursive: true });
  const file = join(home, MERGES_FILE);
  writeFileSync(`${file}.tmp`, `${JSON.stringify(merges, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
}
