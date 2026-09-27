import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { ParseArgsOptionsConfig } from 'node:util';
import { DEFAULT_BLOCK_TAG, DEFAULT_DASHBOARD_PORT, DEFAULT_START_STATUSES, loadConfig, saveConfig } from './config.ts';
import { createActions } from './dashboard/actions.ts';
import { createHandler } from './dashboard/server.ts';
import type { Handler, RunningServer } from './dashboard/server.ts';
import { createSnapshot } from './dashboard/snapshot.ts';
import type { ProjectEntry } from './config.ts';
import { EXIT, OrchestratorError, configError, usageError } from './errors.ts';
import type { RunCommand } from './commands.ts';
import { closeInterruptedClaims, runCycle } from './cycle.ts';
import type { CycleResult } from './cycle.ts';
import { pickTask } from './picker.ts';
import { runLoop } from './scheduler.ts';
import type { RunTaskwire, TaskSummary } from './taskwire.ts';

// Serves the dashboard on 127.0.0.1; replaced in tests so that no port is opened.
export type ServeDashboard = (handler: Handler, port: number) => Promise<RunningServer>;

export interface Writer {
  write(chunk: string): unknown;
}

export interface CliDeps {
  argv: string[];
  cwd: string;
  // Folder of the orchestrator config and state, for example ~/.config/taskwire-orchestrator.
  home: string;
  stdout: Writer;
  stderr: Writer;
  runTaskwire: RunTaskwire;
  runCommand: RunCommand;
  now: () => number;
  // For "start": waits between ticks (returning early when stopped), and tells when to stop.
  sleep: (ms: number) => Promise<void>;
  stopped: () => boolean;
  serve: ServeDashboard;
}

interface Input {
  positionals: string[];
  values: Record<string, string | boolean | undefined>;
}

interface CommandSpec {
  options: ParseArgsOptionsConfig;
  run: (deps: CliDeps, input: Input) => Promise<unknown>;
}

export const HELP = `taskwire-orchestrator: let agents work on the tasks of your projects

  taskwire-orchestrator add <folder> [--test-command <command>]   follow a project set up with taskwire
  taskwire-orchestrator list                                      the projects it follows
  taskwire-orchestrator next                                      the task each project would work on (no changes)
  taskwire-orchestrator run-once                                  one pass: an agent works on the next task of each project
  taskwire-orchestrator start                                     keep working on the projects until Ctrl+C, with the dashboard
  taskwire-orchestrator dashboard                                 only the dashboard, with no agent working, until Ctrl+C

Output is JSON on stdout; errors are JSON lines on stderr.
Exit codes: 0 ok, 1 taskwire or agent failure, 2 usage error, 3 configuration error.
`;

const COMMANDS: Record<string, CommandSpec> = {
  add: { options: { 'test-command': { type: 'string' } }, run: addProject },
  list: { options: {}, run: async (deps) => loadConfig(deps.home).projects },
  next: { options: {}, run: nextTasks },
  'run-once': { options: {}, run: runOnce },
  start: { options: {}, run: start },
  dashboard: { options: {}, run: dashboard },
};

function logTo(deps: CliDeps): (event: Record<string, unknown>) => void {
  return (event) => deps.stdout.write(`${JSON.stringify(event)}\n`);
}

async function start(deps: CliDeps): Promise<undefined> {
  const server = await openDashboard(deps, true);
  try {
    await runLoop({ ...deps, log: logTo(deps) });
  } finally {
    await server.close();
  }
  return undefined;
}

async function dashboard(deps: CliDeps): Promise<undefined> {
  const server = await openDashboard(deps, false);
  while (!deps.stopped()) await deps.sleep(60_000);
  await server.close();
  return undefined;
}

// A new token at every start: the page gets it, and a page from another site cannot know it.
async function openDashboard(deps: CliDeps, agentsRunning: boolean): Promise<RunningServer> {
  const port = loadConfig(deps.home).dashboardPort ?? DEFAULT_DASHBOARD_PORT;
  const snapshot = createSnapshot({ home: deps.home, runTaskwire: deps.runTaskwire, now: deps.now, agentsRunning });
  const act = createActions({ home: deps.home, runTaskwire: deps.runTaskwire, onChange: snapshot.clear });
  const handler = createHandler({ snapshot, token: randomBytes(24).toString('hex'), act });
  let server: RunningServer;
  try {
    server = await deps.serve(handler, port);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EADDRINUSE') {
      throw configError(`Port ${port} is already in use`, 'Stop the program that uses it, or set "dashboardPort" in the orchestrator config');
    }
    throw error;
  }
  logTo(deps)({ event: 'dashboard', at: new Date(deps.now()).toISOString(), url: server.url });
  return server;
}

async function runOnce(deps: CliDeps): Promise<CycleResult[]> {
  const { projects, taskwireCommand } = loadConfig(deps.home);
  const cycleDeps = { ...deps, taskwireCommand };
  await closeInterruptedClaims(cycleDeps);
  const results: CycleResult[] = [];
  for (const project of projects) results.push(await runCycle(cycleDeps, project));
  return results;
}

async function addProject(deps: CliDeps, input: Input): Promise<ProjectEntry> {
  if (input.positionals.length !== 1) throw usageError('Expected exactly one project folder');
  const path = resolve(deps.cwd, input.positionals[0]);
  if (!existsSync(join(path, '.taskwire.json'))) {
    throw usageError(`${path} has no .taskwire.json`, 'Set the project up first: run "taskwire setup" in it');
  }
  const config = loadConfig(deps.home);
  if (config.projects.some((project) => project.path === path)) throw usageError(`${path} is already followed`);
  try {
    await deps.runTaskwire(['conventions'], path);
  } catch (error) {
    throw configError(`taskwire does not work in ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const project: ProjectEntry = { path };
  const testCommand = input.values['test-command'];
  if (typeof testCommand === 'string') {
    if (testCommand.trim() === '') throw usageError('--test-command cannot be empty');
    project.testCommand = testCommand;
  }
  config.projects.push(project);
  saveConfig(deps.home, config);
  return project;
}

async function nextTasks(deps: CliDeps): Promise<{ project: string; task: TaskSummary | null }[]> {
  const rows: { project: string; task: TaskSummary | null }[] = [];
  for (const project of loadConfig(deps.home).projects) {
    const tasks = (await deps.runTaskwire(['tasks'], project.path)) as TaskSummary[];
    const task = pickTask(tasks, {
      statuses: project.startStatuses ?? DEFAULT_START_STATUSES,
      blockTag: project.blockTag ?? DEFAULT_BLOCK_TAG,
    });
    rows.push({ project: project.path, task });
  }
  return rows;
}

function parseInput(spec: CommandSpec, args: string[]): Input {
  try {
    const { positionals, values } = parseArgs({ args, options: spec.options, allowPositionals: true, strict: true });
    return { positionals, values: values as Input['values'] };
  } catch (error) {
    throw usageError(error instanceof Error ? error.message : String(error), 'Run "taskwire-orchestrator --help"');
  }
}

export async function main(deps: CliDeps): Promise<number> {
  const [name, ...rest] = deps.argv;
  if (name === undefined || name === '--help' || name === 'help') {
    deps.stdout.write(HELP);
    return EXIT.ok;
  }
  try {
    const spec = COMMANDS[name];
    if (spec === undefined) throw usageError(`Unknown command "${name}"`, 'Run "taskwire-orchestrator --help"');
    const result = await spec.run(deps, parseInput(spec, rest));
    // "start" prints its events as they happen, so it has no result.
    if (result !== undefined) deps.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return EXIT.ok;
  } catch (error) {
    const known = error instanceof OrchestratorError
      ? error
      : new OrchestratorError(error instanceof Error ? error.message : String(error), EXIT.external);
    const payload: { error: string; hint?: string } = { error: known.message };
    if (known.hint !== undefined) payload.hint = known.hint;
    deps.stderr.write(`${JSON.stringify(payload)}\n`);
    return known.exitCode;
  }
}
