import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { configError } from './errors.ts';

export const MERGE_LEVELS = ['none', 'dev', 'main'] as const;
export type MergeLevel = (typeof MERGE_LEVELS)[number];

export interface ProjectEntry {
  // Absolute path of the project folder, the one with .taskwire.json.
  path: string;
  // Command that runs the project tests, from the project folder (for example "npm test").
  testCommand?: string;
  // Statuses the orchestrator picks tasks from; defaults to DEFAULT_START_STATUSES.
  startStatuses?: string[];
  // Tag that keeps the orchestrator away from a task; defaults to DEFAULT_BLOCK_TAG.
  blockTag?: string;
  // Status a task moves to when an agent takes it; defaults to DEFAULT_WORK_STATUS.
  workStatus?: string;
  // Status the dashboard moves a task to when the person closes it; defaults to the last status of the task's list.
  closedStatus?: string;
  // Runs agents in the Claude Code sandbox. Safer, but the agent cannot reach the git remote over SSH or use gh.
  sandbox?: boolean;
  // Extra domains the sandboxed agent may reach, besides the task system API.
  allowedDomains?: string[];
  // False keeps agents away from the project while it stays followed; defaults to true.
  agents?: boolean;
  // The product the project is part of, with the other projects that share its task list (for example the backend and the app).
  group?: string;
  // Who merges the work of the project: "none" a person (the default), "dev" the orchestrator into the staging branch,
  // "main" the orchestrator into staging and then production.
  merge?: MergeLevel;
  // The staging branch, where the orchestrator merges verified tasks; defaults to DEFAULT_STAGING_BRANCH.
  stagingBranch?: string;
  // The production branch, where releases go; defaults to the default branch of the remote. Set stagingBranch to it when the project has no staging.
  productionBranch?: string;
}

export interface OrchestratorConfig {
  // The taskwire command to run; defaults to "taskwire" on the PATH.
  taskwireCommand?: string;
  // How many agents may work at once, across projects (one per project at most); defaults to DEFAULT_MAX_AGENTS.
  maxAgents?: number;
  // Minutes between two looks at the projects in "start"; defaults to DEFAULT_INTERVAL_MINUTES.
  intervalMinutes?: number;
  // Hours between two analyses of the same project in "start"; defaults to DEFAULT_ANALYSIS_HOURS.
  analysisHours?: number;
  // Port of the dashboard on 127.0.0.1; defaults to DEFAULT_DASHBOARD_PORT.
  dashboardPort?: number;
  // Folders where the dashboard looks for taskwire projects to add; defaults to the folders of the projects followed.
  projectRoots?: string[];
  projects: ProjectEntry[];
}

export const DEFAULT_START_STATUSES = ['backlog', 'to do'];
export const DEFAULT_BLOCK_TAG = 'no-agent';
export const DEFAULT_WORK_STATUS = 'in progress';
export const DEFAULT_MAX_AGENTS = 2;
export const DEFAULT_INTERVAL_MINUTES = 5;
// Low on purpose while the analysis is being tried out.
export const DEFAULT_ANALYSIS_HOURS = 1;
export const DEFAULT_DASHBOARD_PORT = 4777;
export const DEFAULT_STAGING_BRANCH = 'dev';

const CONFIG_FILE = 'config.json';

export function loadConfig(home: string): OrchestratorConfig {
  const path = join(home, CONFIG_FILE);
  if (!existsSync(path)) return { projects: [] };
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw configError(`${path} is not valid JSON`);
  }
  return parseConfig(data, path);
}

export function saveConfig(home: string, config: OrchestratorConfig): void {
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, CONFIG_FILE), `${JSON.stringify(config, null, 2)}\n`);
}

function parseConfig(data: unknown, path: string): OrchestratorConfig {
  const invalid = (reason: string) => configError(`${path}: ${reason}`, 'Fix the file, or remove it and add the projects again');
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw invalid('must contain a JSON object');
  const { taskwireCommand, maxAgents, intervalMinutes, analysisHours, dashboardPort, projectRoots, projects } = data as Record<string, unknown>;
  if (!Array.isArray(projects)) throw invalid('"projects" must be an array');
  const config: OrchestratorConfig = { projects: projects.map((entry: unknown) => parseProject(entry, invalid)) };
  if (taskwireCommand !== undefined) {
    if (typeof taskwireCommand !== 'string' || taskwireCommand.trim() === '') throw invalid('"taskwireCommand" must be a non empty string');
    config.taskwireCommand = taskwireCommand;
  }
  if (maxAgents !== undefined) config.maxAgents = positive(maxAgents, '"maxAgents"', invalid, true);
  if (intervalMinutes !== undefined) config.intervalMinutes = positive(intervalMinutes, '"intervalMinutes"', invalid, false);
  if (analysisHours !== undefined) config.analysisHours = positive(analysisHours, '"analysisHours"', invalid, false);
  if (dashboardPort !== undefined) {
    const port = positive(dashboardPort, '"dashboardPort"', invalid, true);
    if (port > 65535) throw invalid('"dashboardPort" must be a port number, up to 65535');
    config.dashboardPort = port;
  }
  if (projectRoots !== undefined) {
    if (!Array.isArray(projectRoots)) throw invalid('"projectRoots" must be an array');
    config.projectRoots = projectRoots.map((root: unknown) => {
      const path = typeof root === 'string' ? expandHome(root) : '';
      if (!path.startsWith('/')) throw invalid('each of "projectRoots" must be an absolute path');
      return path;
    });
  }
  return config;
}

// Whether agents may take tasks of the project: a followed project has them on unless its entry says otherwise.
export function agentsOn(project: ProjectEntry): boolean {
  return project.agents !== false;
}

// Who merges the work of the project; a person, unless the entry says otherwise.
export function mergeLevel(project: ProjectEntry): MergeLevel {
  return project.merge ?? 'none';
}

function positive(value: unknown, what: string, invalid: (reason: string) => Error, whole: boolean): number {
  if (typeof value !== 'number' || value <= 0 || (whole && !Number.isInteger(value))) {
    throw invalid(`${what} must be a ${whole ? 'whole ' : ''}number greater than 0`);
  }
  return value;
}

function parseProject(entry: unknown, invalid: (reason: string) => Error): ProjectEntry {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw invalid('each project must be an object');
  const { path, testCommand, startStatuses, blockTag, workStatus, closedStatus, sandbox, allowedDomains, agents, area, group, merge, stagingBranch, productionBranch } = entry as Record<string, unknown>;
  if (typeof path !== 'string' || !path.startsWith('/')) throw invalid('each project needs an absolute "path"');
  const project: ProjectEntry = { path };
  if (testCommand !== undefined) project.testCommand = text(testCommand, `"testCommand" of ${path}`, invalid);
  if (blockTag !== undefined) project.blockTag = text(blockTag, `"blockTag" of ${path}`, invalid).toLowerCase();
  if (workStatus !== undefined) project.workStatus = text(workStatus, `"workStatus" of ${path}`, invalid);
  if (closedStatus !== undefined) project.closedStatus = text(closedStatus, `"closedStatus" of ${path}`, invalid);
  // The area moved to the project's .taskwire.json, where the CLI sees it too; the orchestrator never writes in a project.
  if (area !== undefined) {
    const command = typeof area === 'string' ? `taskwire area set ${area.trim().toLowerCase()}` : 'taskwire area set <tag>';
    throw invalid(`"area" of ${path} now lives in taskwire: run "${command}" in ${path}, then remove "area" from the config`);
  }
  if (group !== undefined) project.group = text(group, `"group" of ${path}`, invalid);
  if (sandbox !== undefined) {
    if (typeof sandbox !== 'boolean') throw invalid(`"sandbox" of ${path} must be true or false`);
    project.sandbox = sandbox;
  }
  if (agents !== undefined) {
    if (typeof agents !== 'boolean') throw invalid(`"agents" of ${path} must be true or false`);
    project.agents = agents;
  }
  if (allowedDomains !== undefined) {
    if (!Array.isArray(allowedDomains)) throw invalid(`"allowedDomains" of ${path} must be an array`);
    project.allowedDomains = allowedDomains.map((domain: unknown) => text(domain, `"allowedDomains" of ${path}`, invalid));
  }
  if (startStatuses !== undefined) {
    if (!Array.isArray(startStatuses) || startStatuses.length === 0) throw invalid(`"startStatuses" of ${path} must be a non empty array`);
    project.startStatuses = startStatuses.map((status: unknown) => text(status, `"startStatuses" of ${path}`, invalid));
  }
  if (merge !== undefined) {
    const level = MERGE_LEVELS.find((entry) => entry === merge);
    if (level === undefined) throw invalid(`"merge" of ${path} must be "none", "dev" or "main"`);
    project.merge = level;
  }
  if (stagingBranch !== undefined) project.stagingBranch = text(stagingBranch, `"stagingBranch" of ${path}`, invalid);
  if (productionBranch !== undefined) project.productionBranch = text(productionBranch, `"productionBranch" of ${path}`, invalid);
  return project;
}

function text(value: unknown, what: string, invalid: (reason: string) => Error): string {
  if (typeof value !== 'string' || value.trim() === '') throw invalid(`${what} must be a non empty string`);
  return value;
}

// "~/code" means the code folder in the home folder, as in a shell.
export function expandHome(path: string): string {
  const trimmed = path.trim();
  if (trimmed === '~') return homedir();
  return trimmed.startsWith('~/') ? join(homedir(), trimmed.slice(2)) : trimmed;
}
