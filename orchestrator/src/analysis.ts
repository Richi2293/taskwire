import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { runClaude } from './agent.ts';
import type { AgentResult } from './agent.ts';
import { agentEnv, logPath, writeLog } from './cycle.ts';
import type { CycleDeps } from './cycle.ts';
import { loadConfig } from './config.ts';
import type { ProjectEntry } from './config.ts';
import { analysisPrompt } from './prompts.ts';
import { readClaims, writeClaims } from './state.ts';
import { createWorktree, worktreePath } from './worktree.ts';

// One analysis of a project, appended to analyses.jsonl: when it ran and what the agent told the person.
export interface AnalysisRecord {
  project: string;
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  // The agent's final answer for the person, or why the run failed.
  summary: string;
  costUsd: number | null;
  durationMs: number | null;
  log: string;
}

const ANALYSES_FILE = 'analyses.jsonl';
// The worktree of the analysis sits next to the task worktrees of the project, under this name.
const WORKTREE_NAME = 'analysis';

// The key of an analysis in claims.json, where the dashboard finds the agents at work.
export function analysisClaimKey(project: string): string {
  return `analysis:${project}`;
}

// The latest analysis of the project, or null when it was never analysed.
export function lastAnalysis(home: string, project: string): AnalysisRecord | null {
  const path = join(home, ANALYSES_FILE);
  if (!existsSync(path)) return null;
  let latest: AnalysisRecord | null = null;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    try {
      const record = JSON.parse(line) as AnalysisRecord;
      if (record.project === project) latest = record;
    } catch {
      // A write cut short: skipped, as in runs.jsonl.
    }
  }
  return latest;
}

// A project is analysed the first time it is seen, then again once the hours have passed since the last analysis started.
export function analysisDue(home: string, project: string, now: number, hours: number): boolean {
  const last = lastAnalysis(home, project);
  return last === null || now - Date.parse(last.startedAt) >= hours * 3600_000;
}

// Lets an agent review the tasks of the project, check the work waiting for a person and propose new tasks.
// A failed run is recorded too, so it is tried again only after the hours, not at every tick.
export async function runAnalysis(deps: CycleDeps, project: ProjectEntry): Promise<AnalysisRecord> {
  const startedAt = new Date(deps.now()).toISOString();
  const worktree = worktreePath(deps.home, project.path, WORKTREE_NAME);
  const key = analysisClaimKey(project.path);
  writeClaims(deps.home, { ...readClaims(deps.home), [key]: { project: project.path, name: 'Project analysis', worktree, startedAt, kind: 'analysis' } });

  const log = logPath(deps.home, `analysis-${basename(project.path)}`, startedAt);
  let agent: AgentResult | null = null;
  let failure: string | null = null;
  try {
    await freshWorktree(deps, project.path, worktree);
    agent = await runClaude(
      deps.runCommand,
      { prompt: analysisPrompt(project, groupAreas(deps.home, project)), cwd: worktree },
      { sandbox: project.sandbox ?? false, allowedDomains: project.allowedDomains ?? [], env: agentEnv(deps.home, deps.taskwireCommand) },
    );
    if (!agent.ok) failure = agent.summary;
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  } finally {
    const claims = readClaims(deps.home);
    delete claims[key];
    writeClaims(deps.home, claims);
  }
  writeLog(log, agent === null ? [] : [agent.output], failure);

  const record: AnalysisRecord = {
    project: project.path,
    startedAt,
    finishedAt: new Date(deps.now()).toISOString(),
    ok: failure === null,
    summary: failure ?? agent?.summary ?? '',
    costUsd: agent?.costUsd ?? null,
    durationMs: agent?.durationMs ?? null,
    log,
  };
  mkdirSync(deps.home, { recursive: true });
  appendFileSync(join(deps.home, ANALYSES_FILE), `${JSON.stringify(record)}\n`);
  return record;
}

// The areas of the other projects of the group, so the agent knows which tags belong to them.
function groupAreas(home: string, project: ProjectEntry): string[] {
  if (project.group === undefined) return [];
  const areas = loadConfig(home).projects
    .filter((entry) => entry.path !== project.path && entry.group === project.group && entry.area !== undefined && entry.area !== project.area)
    .map((entry) => entry.area ?? '');
  return [...new Set(areas)];
}

// Every analysis starts from the latest code: the worktree of the previous one is removed first.
async function freshWorktree(deps: CycleDeps, project: string, worktree: string): Promise<void> {
  if (existsSync(worktree)) {
    // Fails when git no longer knows the worktree; the folder is removed anyway.
    await deps.runCommand('git', ['worktree', 'remove', '--force', worktree], { cwd: project });
    rmSync(worktree, { recursive: true, force: true });
    await deps.runCommand('git', ['worktree', 'prune'], { cwd: project });
  }
  await createWorktree(deps.runCommand, project, worktree);
}
