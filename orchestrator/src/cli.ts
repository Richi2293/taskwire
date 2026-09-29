import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { ParseArgsOptionsConfig } from 'node:util';
import { DEFAULT_BLOCK_TAG, DEFAULT_DASHBOARD_PORT, DEFAULT_START_STATUSES, agentsOn, expandHome, loadConfig } from './config.ts';
import { createRunControl } from './control.ts';
import type { RunControl } from './control.ts';
import { createActions } from './dashboard/actions.ts';
import { createProjectActions } from './dashboard/project-actions.ts';
import { createHandler } from './dashboard/server.ts';
import type { Handler, RunningServer } from './dashboard/server.ts';
import { createStore } from './dashboard/snapshot.ts';
import type { Store } from './dashboard/snapshot.ts';
import type { ProjectEntry } from './config.ts';
import { EXIT, OrchestratorError, configError, usageError } from './errors.ts';
import { discoverProjects, followProject, projectSearchRoots, unfollowProject } from './projects.ts';
import type { RunCommand } from './commands.ts';
import { closeInterruptedClaims, runCycle } from './cycle.ts';
import type { CycleResult } from './cycle.ts';
import { MAX_TASKWIRE_CALLS, limitCalls } from './limit.ts';
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
  taskwire-orchestrator remove <folder>                           stop following a project (its folder and tasks stay)
  taskwire-orchestrator list                                      the projects it follows
  taskwire-orchestrator next                                      the task each project would work on (no changes)
  taskwire-orchestrator run-once                                  one pass: an agent works on the next task of each project
  taskwire-orchestrator start                                     open the dashboard until Ctrl+C; agents work once you press play there

Output is JSON on stdout; errors are JSON lines on stderr.
Exit codes: 0 ok, 1 taskwire or agent failure, 2 usage error, 3 configuration error.
`;

const COMMANDS: Record<string, CommandSpec> = {
  add: { options: { 'test-command': { type: 'string' } }, run: addProject },
  remove: { options: {}, run: removeProject },
  list: { options: {}, run: async (deps) => loadConfig(deps.home).projects },
  next: { options: {}, run: nextTasks },
  'run-once': { options: {}, run: runOnce },
  start: { options: {}, run: start },
};

function logTo(deps: CliDeps): (event: Record<string, unknown>) => void {
  return (event) => deps.stdout.write(`${JSON.stringify(event)}\n`);
}

// Starts paused: agents take tasks only after play on the dashboard.
async function start(deps: CliDeps): Promise<undefined> {
  const log = logTo(deps);
  const control = createRunControl((working) => log({ event: working ? 'play' : 'pause', at: new Date(deps.now()).toISOString() }));
  let nextCheckAt: number | null = null;
  const { server, store } = await openDashboard(deps, control, () => nextCheckAt);
  try {
    await runLoop({ ...deps, log, control, onWait: (until) => { nextCheckAt = until; } });
  } finally {
    await store.idle();
    await server.close();
  }
  return undefined;
}

// A new token at every start: the page gets it, and a page from another site cannot know it.
async function openDashboard(
  deps: CliDeps,
  control: RunControl,
  nextCheckAt: () => number | null,
): Promise<{ server: RunningServer; store: Store }> {
  const port = loadConfig(deps.home).dashboardPort ?? DEFAULT_DASHBOARD_PORT;
  const store = createStore({ home: deps.home, runTaskwire: deps.runTaskwire, now: deps.now, working: control.working, nextCheckAt });
  const act = createActions({ home: deps.home, runTaskwire: deps.runTaskwire, onChange: store.changed });
  const log = logTo(deps);
  const handler = createHandler({
    // The page gets the last data at once; looking at it reads the projects again in the background when needed.
    snapshot: async () => {
      store.look();
      return store.state();
    },
    refresh: () => { void store.refresh(); },
    token: randomBytes(24).toString('hex'),
    act,
    control,
    projects: createProjectActions({ home: deps.home, runTaskwire: deps.runTaskwire, onChange: (project) => store.changed(project) }),
    discover: () => {
      const config = loadConfig(deps.home);
      return discoverProjects({ roots: projectSearchRoots(config), followed: config.projects.map((project) => project.path) });
    },
    onAction: (event) => log({ event: 'action', at: new Date(deps.now()).toISOString(), ...event }),
  });
  let server: RunningServer;
  try {
    server = await deps.serve(handler, port);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EADDRINUSE') {
      throw configError(`Port ${port} is already in use`, 'Stop the program that uses it, or set "dashboardPort" in the orchestrator config');
    }
    throw error;
  }
  log({ event: 'dashboard', at: new Date(deps.now()).toISOString(), url: server.url });
  return { server, store };
}

async function runOnce(deps: CliDeps): Promise<CycleResult[]> {
  const { projects, taskwireCommand } = loadConfig(deps.home);
  const cycleDeps = { ...deps, taskwireCommand };
  await closeInterruptedClaims(cycleDeps);
  const results: CycleResult[] = [];
  for (const project of projects.filter(agentsOn)) results.push(await runCycle(cycleDeps, project));
  return results;
}

async function addProject(deps: CliDeps, input: Input): Promise<ProjectEntry> {
  const testCommand = input.values['test-command'];
  return followProject(deps, projectFolder(deps, input), typeof testCommand === 'string' ? testCommand : undefined);
}

async function removeProject(deps: CliDeps, input: Input): Promise<{ removed: string }> {
  const path = projectFolder(deps, input);
  unfollowProject(deps.home, path);
  return { removed: path };
}

function projectFolder(deps: CliDeps, input: Input): string {
  if (input.positionals.length !== 1) throw usageError('Expected exactly one project folder');
  return resolve(deps.cwd, expandHome(input.positionals[0]));
}

async function nextTasks(deps: CliDeps): Promise<{ project: string; agents: boolean; task: TaskSummary | null }[]> {
  const rows: { project: string; agents: boolean; task: TaskSummary | null }[] = [];
  for (const project of loadConfig(deps.home).projects) {
    // No agent takes a task of a project with agents off, so its tasks are not read.
    if (!agentsOn(project)) {
      rows.push({ project: project.path, agents: false, task: null });
      continue;
    }
    const tasks = (await deps.runTaskwire(['tasks'], project.path)) as TaskSummary[];
    const task = pickTask(tasks, {
      statuses: project.startStatuses ?? DEFAULT_START_STATUSES,
      blockTag: project.blockTag ?? DEFAULT_BLOCK_TAG,
    });
    rows.push({ project: project.path, agents: true, task });
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
    // Every taskwire call of the orchestrator, from the dashboard or the loop, shares one limit.
    const limited = { ...deps, runTaskwire: limitCalls(deps.runTaskwire, MAX_TASKWIRE_CALLS) };
    const result = await spec.run(limited, parseInput(spec, rest));
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
