import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/cli.ts';
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

// Answers each taskwire command with the reply keyed by its first words, for example "tasks" or "conventions".
export function fakeTaskwire(replies: Record<string, unknown>): { run: RunTaskwire; calls: TaskwireCall[] } {
  const calls: TaskwireCall[] = [];
  const run: RunTaskwire = async (args, cwd) => {
    calls.push({ args, cwd });
    const key = Object.keys(replies).find((prefix) => args.join(' ').startsWith(prefix));
    if (key === undefined) throw new Error(`No fake reply for taskwire ${args.join(' ')}`);
    return replies[key];
  };
  return { run, calls };
}

export interface OrchestratorRun {
  code: number;
  stdout: string;
  stderr: string;
  json: () => unknown;
}

export async function runOrchestrator(
  argv: string[],
  options: { home?: string; cwd?: string; taskwire?: RunTaskwire } = {},
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
  });
  const stdout = out.join('');
  return { code, stdout, stderr: err.join(''), json: () => JSON.parse(stdout) };
}
