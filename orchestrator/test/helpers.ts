import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/cli.ts';
import type { CommandResult, RunCommand } from '../src/commands.ts';
import type { RunTaskwire } from '../src/taskwire.ts';
import type { TaskSummary } from '../src/taskwire.ts';

export function task(overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id: 't1',
    name: 'Task one',
    status: 'backlog',
    priority: null,
    tags: [],
    needs: null,
    parent: null,
    url: 'https://app.clickup.com/t/t1',
    ...overrides,
  };
}

export function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `orchestrator-${prefix}-`));
}

// A folder with a .taskwire.json, like a project set up with taskwire.
export function projectDir(name = 'website'): string {
  const dir = join(tempDir('project'), name);
  mkdirSync(dir);
  writeFileSync(join(dir, '.taskwire.json'), JSON.stringify({ provider: 'clickup', folderId: '900' }));
  return dir;
}

export interface TaskwireCall {
  args: string[];
  cwd: string;
}

// A reply, or a function of the arguments for replies that change during a run.
export type FakeReply = unknown | ((args: string[]) => unknown);

// Answers each taskwire command with the reply keyed by its first words, for example "tasks" or "task get".
export function fakeTaskwire(replies: Record<string, FakeReply>): { run: RunTaskwire; calls: TaskwireCall[] } {
  const calls: TaskwireCall[] = [];
  const run: RunTaskwire = async (args, cwd) => {
    calls.push({ args, cwd });
    const key = Object.keys(replies).find((prefix) => `${args.join(' ')} `.startsWith(`${prefix} `));
    if (key === undefined) throw new Error(`No fake reply for taskwire ${args.join(' ')}`);
    const reply = replies[key];
    return typeof reply === 'function' ? (reply as (args: string[]) => unknown)(args) : reply;
  };
  return { run, calls };
}

export interface CommandCall {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

// Stands in for git and the agent CLI: each command answers with its handler, or succeeds with no output.
export function fakeCommands(
  handlers: Record<string, (call: CommandCall) => Partial<CommandResult>> = {},
): { run: RunCommand; calls: CommandCall[] } {
  const calls: CommandCall[] = [];
  const run: RunCommand = async (command, args, options) => {
    const call = { command, args, cwd: options.cwd, env: options.env ?? {} };
    calls.push(call);
    const handler = handlers[`${command} ${args[0] ?? ''}`.trim()] ?? handlers[command];
    return { code: 0, stdout: '', stderr: '', ...handler?.(call) };
  };
  return { run, calls };
}

// The JSON that "claude -p --output-format json" prints at the end of a run.
export function claudeResult(overrides: Record<string, unknown> = {}): Partial<CommandResult> {
  return {
    stdout: JSON.stringify({
      type: 'result',
      is_error: false,
      result: 'Done: discount added, tests pass.',
      session_id: 'session-1',
      total_cost_usd: 0.42,
      duration_ms: 90_000,
      num_turns: 12,
      ...overrides,
    }),
  };
}

export interface OrchestratorRun {
  code: number;
  stdout: string;
  stderr: string;
  json: () => unknown;
}

export async function runOrchestrator(
  argv: string[],
  options: { home?: string; cwd?: string; taskwire?: RunTaskwire; commands?: RunCommand; now?: () => number } = {},
): Promise<OrchestratorRun> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main({
    argv,
    cwd: options.cwd ?? tempDir('cwd'),
    home: options.home ?? tempDir('home'),
    stdout: { write: (chunk: string) => out.push(chunk) },
    stderr: { write: (chunk: string) => err.push(chunk) },
    runTaskwire: options.taskwire ?? fakeTaskwire({}).run,
    runCommand: options.commands ?? fakeCommands().run,
    now: options.now ?? (() => Date.UTC(2026, 8, 27, 10, 0, 0)),
  });
  const stdout = out.join('');
  return { code, stdout, stderr: err.join(''), json: () => JSON.parse(stdout) };
}
