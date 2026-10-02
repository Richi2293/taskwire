import { analysisDue, runAnalysis } from './analysis.ts';
import type { AnalysisRecord } from './analysis.ts';
import { DEFAULT_ANALYSIS_HOURS, DEFAULT_INTERVAL_MINUTES, DEFAULT_MAX_AGENTS, agentsOn, loadConfig } from './config.ts';
import type { OrchestratorConfig, ProjectEntry } from './config.ts';
import { closeInterruptedClaims, runCycle } from './cycle.ts';
import type { CycleDeps, CycleResult } from './cycle.ts';
import type { RunControl } from './control.ts';
import { pruneOld } from './journal.ts';
import { upkeep as upkeepProject } from './upkeep.ts';

export interface LoopDeps extends CycleDeps {
  // One event per line: what the loop did, for the terminal and later the dashboard.
  log: (event: Record<string, unknown>) => void;
  sleep: (ms: number) => Promise<void>;
  // True once the loop must stop (Ctrl+C); running cycles are then awaited.
  stopped: () => boolean;
  // The work on one project; replaced in tests.
  cycle?: (deps: CycleDeps, project: ProjectEntry) => Promise<CycleResult>;
  // The analysis of one project; replaced in tests.
  analyze?: (deps: CycleDeps, project: ProjectEntry) => Promise<AnalysisRecord>;
  // Merges, releases and live tasks of a project, at every tick; replaced in tests.
  upkeep?: (deps: CycleDeps, project: ProjectEntry, working: boolean) => Promise<void>;
  // Play and pause from the dashboard; without it the loop always works.
  control?: RunControl;
  // Told before each wait: when the loop looks for new tasks next, or null while paused.
  onWait?: (until: number | null) => void;
}

// Runs cycles until stopped: at most maxAgents at once, one per project and one per group, taking projects in turn.
export async function runLoop(deps: LoopDeps): Promise<void> {
  const cycle = deps.cycle ?? runCycle;
  const analyze = deps.analyze ?? runAnalysis;
  const upkeep = deps.upkeep ?? upkeepProject;
  const at = () => new Date(deps.now()).toISOString();
  pruneOld(deps.home, deps.now());
  deps.log({ event: 'start', at: at() });
  for (const taskId of await closeInterruptedClaims(deps)) deps.log({ event: 'interrupted', at: at(), task: taskId });

  const running = new Map<string, Promise<void>>();
  // Groups with an agent at work: the projects of a group share local ports, databases and tasks, so one works at a time.
  const busyGroups = new Set<string>();
  // When each project last got a slot, so the one that waited longest goes first and every project gets its turn.
  const lastStarted = new Map<string, number>();
  let starts = 0;
  while (!deps.stopped()) {
    // Read at every tick, so projects added meanwhile join without a restart.
    let config: OrchestratorConfig;
    try {
      config = loadConfig(deps.home);
    } catch (error) {
      // A config edited by hand may be broken for a while: wait for the fix instead of stopping.
      deps.log({ event: 'error', at: at(), error: error instanceof Error ? error.message : String(error) });
      await deps.sleep(DEFAULT_INTERVAL_MINUTES * 60_000);
      continue;
    }
    const intervalMs = (config.intervalMinutes ?? DEFAULT_INTERVAL_MINUTES) * 60_000;
    const maxAgents = config.maxAgents ?? DEFAULT_MAX_AGENTS;
    const analysisHours = config.analysisHours ?? DEFAULT_ANALYSIS_HOURS;
    const cycleDeps: CycleDeps = { ...deps, taskwireCommand: config.taskwireCommand };
    // While paused, or on a project with agents off, nothing new starts; agents already at work finish their task.
    const working = deps.control === undefined || deps.control.working();
    const projects = working ? config.projects.filter(agentsOn) : [];
    // Upkeep first: it needs no agent, and a merged task should not wait for a free slot.
    // Every project gets it, paused too, but only the ones where agents may work get merges and releases.
    for (const project of config.projects) {
      try {
        await upkeep(cycleDeps, project, working && agentsOn(project));
      } catch (error) {
        deps.log({ event: 'error', at: at(), project: project.path, error: error instanceof Error ? error.message : String(error) });
      }
    }
    // A project never started comes first, in config order; the sort is stable.
    const queue = [...projects].sort((a, b) => (lastStarted.get(a.path) ?? 0) - (lastStarted.get(b.path) ?? 0));
    for (const project of queue) {
      if (running.size >= maxAgents) break;
      const group = project.group;
      if (running.has(project.path) || (group !== undefined && busyGroups.has(group))) continue;
      starts += 1;
      lastStarted.set(project.path, starts);
      if (group !== undefined) busyGroups.add(group);
      const logError = (error: unknown) => {
        deps.log({ event: 'error', at: at(), project: project.path, error: error instanceof Error ? error.message : String(error) });
      };
      // A due analysis comes first, in the same slot, so the task picked next reflects it. A failed analysis does not stop the task.
      const analysis = analysisDue(deps.home, project.path, deps.now(), analysisHours)
        ? analyze(cycleDeps, project)
          .then((record) => {
            deps.log({ event: 'analysis', at: at(), project: project.path, ok: record.ok, summary: record.summary, costUsd: record.costUsd });
          })
          .catch(logError)
        : Promise.resolve();
      const work = analysis
        .then(() => cycle(cycleDeps, project))
        .then((result) => {
          if (result.task !== null) deps.log({ event: 'run', at: at(), project: project.path, ...result.task });
        })
        .catch(logError)
        .finally(() => {
          running.delete(project.path);
          if (group !== undefined) busyGroups.delete(group);
        });
      running.set(project.path, work);
    }
    deps.onWait?.(working ? deps.now() + intervalMs : null);
    // A play or a pause cuts the wait short, so the person sees the change at once.
    await Promise.race([deps.sleep(intervalMs), ...(deps.control === undefined ? [] : [deps.control.changed()])]);
  }
  await Promise.all(running.values());
  deps.log({ event: 'stop', at: at() });
}
