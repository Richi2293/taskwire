import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentResult } from './agent.ts';

// What the orchestrator did and when, one JSON object per line: the diary read to understand a run afterwards.
// Its fields never depend on the agent CLI, so it reads the same whatever model does the work.
export type Event = Record<string, unknown>;
export type Log = (event: Event) => void;

// Why an agent session ran.
export type Role = 'author' | 'nudge' | 'fix-tests' | 'fix-findings' | 'verifier' | 'analysis';

// One agent session, in the fields every agent CLI can give.
export interface SessionRecord {
  role: Role;
  agent: string;
  sessionId: string | null;
  ok: boolean;
  costUsd: number | null;
  durationMs: number | null;
}

const EVENTS_FILE = 'events.jsonl';
const LOGS_DIR = 'logs';
// Logs and events older than this are removed at every start, so the folder does not grow for ever.
const KEEP_DAYS = 30;

export function sessionRecord(role: Role, result: AgentResult): SessionRecord {
  return { role, agent: result.agent, sessionId: result.sessionId, ok: result.ok, costUsd: result.costUsd, durationMs: result.durationMs };
}

// The whole output of a session for the run log, under a heading that says which session it is.
export function logSection(session: SessionRecord, output: string): string {
  return `=== ${session.role}: ${session.agent}, session ${session.sessionId ?? 'unknown'} ===\n${output}`;
}

export function appendEvent(home: string, event: Event): void {
  mkdirSync(home, { recursive: true });
  appendFileSync(join(home, EVENTS_FILE), `${JSON.stringify(event)}\n`);
}

export function pruneOld(home: string, now: number): void {
  const cutoff = now - KEEP_DAYS * 86_400_000;
  const logs = join(home, LOGS_DIR);
  if (existsSync(logs)) {
    for (const name of readdirSync(logs)) {
      const path = join(logs, name);
      if (statSync(path).mtimeMs < cutoff) rmSync(path, { force: true });
    }
  }
  const events = join(home, EVENTS_FILE);
  if (!existsSync(events)) return;
  const kept = readFileSync(events, 'utf8').split('\n').filter((line) => {
    if (line.trim() === '') return false;
    try {
      const at = (JSON.parse(line) as { at?: unknown }).at;
      return typeof at === 'string' && Date.parse(at) >= cutoff;
    } catch {
      // A line cut short is of no use.
      return false;
    }
  });
  writeFileSync(events, kept.map((line) => `${line}\n`).join(''));
}
