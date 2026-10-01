import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunRecord } from './state.ts';

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
  // Who let the merge go: the verifier (all criteria verified) or the person (It works, Approve); missing means the verifier.
  approvedBy?: 'verifier' | 'person';
  queuedAt: string;
}

const MERGES_FILE = 'merges.json';

// Whether the person's approval of a task can let the orchestrator merge it: its last run left a pull request at a known commit,
// and the verifier passed it in full or but for the checks by hand. A run that failed its checks is the person's to merge.
export function approvalCanMerge(run: RunRecord | undefined): run is RunRecord & { branch: string; pr: number; sha: string } {
  return run !== undefined && Boolean(run.branch) && Boolean(run.pr) && Boolean(run.sha) && (run.verdict === 'pass' || run.verdict === 'manual');
}

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
