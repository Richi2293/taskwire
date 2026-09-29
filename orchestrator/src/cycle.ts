import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runClaude } from './agent.ts';
import type { AgentOptions, AgentResult } from './agent.ts';
import type { RunCommand } from './commands.ts';
import { DEFAULT_BLOCK_TAG, DEFAULT_START_STATUSES, DEFAULT_WORK_STATUS } from './config.ts';
import type { ProjectEntry } from './config.ts';
import { configError } from './errors.ts';
import { pickTask } from './picker.ts';
import { markPrompt, workPrompt } from './prompts.ts';
import { appendRun, readClaims, writeClaims } from './state.ts';
import type { RunRecord } from './state.ts';
import type { RunTaskwire, TaskSummary } from './taskwire.ts';
import { addCost, verifyWork } from './verify.ts';
import type { Verification } from './verify.ts';
import { createWorktree, worktreePath } from './worktree.ts';

export interface CycleDeps {
  home: string;
  runTaskwire: RunTaskwire;
  runCommand: RunCommand;
  now: () => number;
  // The taskwire the orchestrator uses, when it is not the one on the PATH; the agent must use it too.
  taskwireCommand?: string;
}

export interface CycleResult {
  project: string;
  task: { id: string; name: string; needs: string | null; status: string | null } | null;
}

// One pass on a project: pick a task, let an agent work on it in its own worktree, and make sure it ends marked for a person.
export async function runCycle(deps: CycleDeps, project: ProjectEntry): Promise<CycleResult> {
  const tasks = (await deps.runTaskwire(['tasks'], project.path)) as TaskSummary[];
  assertNeedsSupport(tasks);
  const task = pickTask(tasks, {
    statuses: project.startStatuses ?? DEFAULT_START_STATUSES,
    blockTag: project.blockTag ?? DEFAULT_BLOCK_TAG,
    area: project.area,
  });
  if (task === null) return { project: project.path, task: null };

  const startedAt = new Date(deps.now()).toISOString();
  const worktree = worktreePath(deps.home, project.path, task.id);
  await deps.runTaskwire(['task', 'update', task.id, '--status', project.workStatus ?? DEFAULT_WORK_STATUS], project.path);
  writeClaims(deps.home, { ...readClaims(deps.home), [task.id]: { project: project.path, name: task.name, worktree, startedAt } });

  const agentOptions: AgentOptions = {
    sandbox: project.sandbox ?? false,
    allowedDomains: project.allowedDomains ?? [],
    env: agentEnv(deps.home, deps.taskwireCommand),
  };
  const log = logPath(deps.home, task.id, startedAt);
  const outputs: string[] = [];
  let agent: AgentResult | null = null;
  let failure: string | null = null;
  try {
    await createWorktree(deps.runCommand, project.path, worktree);
    agent = await runClaude(deps.runCommand, { prompt: workPrompt(task, project), cwd: worktree }, agentOptions);
    outputs.push(agent.output);
    if (!agent.ok) failure = agent.summary;
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  let costUsd = agent?.costUsd ?? null;
  let after = await readTask(deps, project.path, task.id);
  if (after.needs === null && failure === null && agent?.sessionId) {
    const nudge = await runClaude(deps.runCommand, { prompt: markPrompt(task), cwd: worktree, resume: agent.sessionId }, agentOptions);
    outputs.push(nudge.output);
    costUsd = addCost(costUsd, nudge.costUsd);
    after = await readTask(deps, project.path, task.id);
  }
  // Only work the agent says is done gets checked: a decision or a failed run goes straight to a person.
  let verification: Verification | null = null;
  if (failure === null && (after.needs === 'review' || after.needs === 'test')) {
    verification = await verifyWork(deps.runCommand, {
      task,
      worktree,
      testCommand: project.testCommand,
      authorSession: agent?.sessionId ?? null,
      agentOptions,
    });
    outputs.push(...verification.outputs);
    costUsd = addCost(costUsd, verification.costUsd);
    after = await readTask(deps, project.path, task.id);
  }
  writeLog(log, outputs, failure);
  let problem = verification?.problem ?? null;
  if (problem === null && after.needs === null) {
    problem = failure === null ? 'the agent stopped without marking the task' : `the agent run failed: ${failure}`;
  }
  if (problem !== null) {
    await markForReview(deps, project.path, task.id, `${problem}.`, worktree, log);
    after = { ...after, needs: 'review' };
  }

  const record: RunRecord = {
    project: project.path,
    task: task.id,
    name: task.name,
    url: task.url,
    startedAt,
    finishedAt: new Date(deps.now()).toISOString(),
    durationMs: agent?.durationMs ?? null,
    costUsd,
    needs: after.needs,
    status: after.status,
    summary: problem ?? agent?.summary ?? '',
    tests: verification?.tests ?? null,
    verdict: verification?.verdict ?? null,
    worktree,
    log,
  };
  appendRun(deps.home, record);
  const claims = readClaims(deps.home);
  delete claims[task.id];
  writeClaims(deps.home, claims);
  return { project: project.path, task: { id: task.id, name: task.name, needs: after.needs, status: after.status } };
}

// Claims left on disk belong to runs cut short (a crash, a restart): hand those tasks to a person.
export async function closeInterruptedClaims(deps: CycleDeps): Promise<string[]> {
  const claims = readClaims(deps.home);
  const closed: string[] = [];
  for (const [taskId, claim] of Object.entries(claims)) {
    // An analysis cut short changed no task of its own: it runs again at the next start.
    if (claim.kind === 'analysis') {
      delete claims[taskId];
      writeClaims(deps.home, claims);
      continue;
    }
    await markForReview(deps, claim.project, taskId, `the orchestrator was interrupted while an agent worked on it (started ${claim.startedAt}).`, claim.worktree);
    delete claims[taskId];
    writeClaims(deps.home, claims);
    closed.push(taskId);
  }
  return closed;
}

// The orchestrator's own comments are in English: the agent writes in the project language.
async function markForReview(deps: CycleDeps, project: string, taskId: string, reason: string, worktree: string, log?: string): Promise<void> {
  await deps.runTaskwire(['task', 'update', taskId, '--needs', 'review'], project);
  const logLine = log === undefined ? '' : ` The agent log is \`${log}\`.`;
  const text = `> **Status:** waiting for a person: ${reason}\n> **Next:** check the work in \`${worktree}\`, then clear \`needs\` or move the task.${logLine}`;
  await deps.runTaskwire(['comment', 'add', taskId, '--text', text], project);
}

async function readTask(deps: CycleDeps, project: string, taskId: string): Promise<{ needs: string | null; status: string | null }> {
  const task = (await deps.runTaskwire(['task', 'get', taskId, '--comments', '0'], project)) as Partial<TaskSummary>;
  return { needs: task.needs ?? null, status: task.status ?? null };
}

// The agent runs "taskwire" from its PATH: a link in the orchestrator's bin folder makes it the configured one.
export function agentEnv(home: string, taskwireCommand: string | undefined): Record<string, string> {
  if (taskwireCommand === undefined) return {};
  const bin = join(home, 'bin');
  const link = join(bin, 'taskwire');
  mkdirSync(bin, { recursive: true });
  // force also removes a link whose target is gone.
  rmSync(link, { force: true });
  symlinkSync(taskwireCommand, link);
  return { PATH: `${bin}:${process.env.PATH ?? ''}` };
}

export function logPath(home: string, taskId: string, startedAt: string): string {
  return join(home, 'logs', `${taskId}-${startedAt.replace(/[:.]/g, '-')}.log`);
}

export function writeLog(path: string, outputs: string[], failure: string | null): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `${outputs.join('\n\n')}${failure === null ? '' : `\n\n[failure]\n${failure}`}\n`);
}

// taskwire 0.1.6 and older have no needs mark: the orchestrator could never tell which tasks wait for a person.
function assertNeedsSupport(tasks: TaskSummary[]): void {
  if (tasks.length > 0 && !('needs' in tasks[0])) {
    throw configError(
      'This taskwire is too old: its tasks have no "needs" field',
      'Point "taskwireCommand" in the orchestrator config to a taskwire with --needs, for example a clone: /path/to/taskwire/bin/taskwire',
    );
  }
}
