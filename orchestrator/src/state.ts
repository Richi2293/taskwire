import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { configError } from './errors.ts';

// A task the orchestrator is working on. Kept on disk, so a run cut short is found at the next start.
export interface Claim {
  project: string;
  name: string;
  worktree: string;
  startedAt: string;
}

// One agent run, appended to runs.jsonl: the history the dashboard shows.
export interface RunRecord {
  project: string;
  task: string;
  name: string;
  url: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number | null;
  costUsd: number | null;
  needs: string | null;
  status: string | null;
  summary: string;
  worktree: string;
  log: string;
}

const CLAIMS_FILE = 'claims.json';
const RUNS_FILE = 'runs.jsonl';

export function readClaims(home: string): Record<string, Claim> {
  const path = join(home, CLAIMS_FILE);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, Claim>;
  } catch {
    throw configError(`${path} is not valid JSON`, 'Check the tasks it lists, then remove the file');
  }
}

export function writeClaims(home: string, claims: Record<string, Claim>): void {
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, CLAIMS_FILE), `${JSON.stringify(claims, null, 2)}\n`);
}

export function appendRun(home: string, record: RunRecord): void {
  mkdirSync(home, { recursive: true });
  appendFileSync(join(home, RUNS_FILE), `${JSON.stringify(record)}\n`);
}
