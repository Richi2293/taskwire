import { analysisDue, runAnalysis } from './analysis.ts';
import type { AnalysisRecord } from './analysis.ts';
import { DEFAULT_ANALYSIS_HOURS, DEFAULT_INTERVAL_MINUTES, DEFAULT_MAX_AGENTS, agentsOn, loadConfig } from './config.ts';
import type { OrchestratorConfig, ProjectEntry } from './config.ts';
import { closeInterruptedClaims, runCycle } from './cycle.ts';
import type { CycleDeps, CycleResult } from './cycle.ts';
import type { RunControl } from './control.ts';

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
  // Play and pause from the dashboard; without it the loop always works.
  control?: RunControl;
  // Told before each wait: when the loop looks for new tasks next, or null while paused.
  onWait?: (until: number | null) => void;
}

// Runs cycles until stopped: at most maxAgents at once, one per project, taking projects in turn.
export async function runLoop(deps: LoopDeps): Promise<void> {
  const cycle = deps.cycle ?? runCycle;
  const analyze = deps.analyze ?? runAnalysis;
  const at = () => new Date(deps.now()).toISOString();
  deps.log({ event: 'start', at: at() });
  for (const taskId of await closeInterruptedClaims(deps)) deps.log({ event: 'interrupted', at: at(), task: taskId });

  const running = new Map<string, Promise<void>>();
  // Groups with an analysis at work: two projects of a group share tasks, so they are analysed one at a time.
  const analysing = new Set<string>();
  // The index, in the project list, where the next pass starts, so every project gets its turn.
  let turn = 0;
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
    const first = turn;
    for (let offset = 0; offset < projects.length && running.size < maxAgents; offset++) {
      const index = (first + offset) % projects.length;
      const project = projects[index];
      if (running.has(project.path)) continue;
      turn = index + 1;
      const logError = (error: unknown) => {
        deps.log({ event: 'error', at: at(), project: project.path, error: error instanceof Error ? error.message : String(error) });
      };
      // A due analysis comes first, in the same slot, so the task picked next reflects it. A failed analysis does not stop the task.
      // A project whose group is being analysed waits for the next tick for its own analysis, and works meanwhile.
      const group = project.group;
      const due = analysisDue(deps.home, project.path, deps.now(), analysisHours) && (group === undefined || !analysing.has(group));
      if (due && group !== undefined) analysing.add(group);
      const analysis = due
        ? analyze(cycleDeps, project)
          .then((record) => {
            deps.log({ event: 'analysis', at: at(), project: project.path, ok: record.ok, summary: record.summary, costUsd: record.costUsd });
          })
          .catch(logError)
          .finally(() => {
            if (group !== undefined) analysing.delete(group);
          })
        : Promise.resolve();
      const work = analysis
        .then(() => cycle(cycleDeps, project))
        .then((result) => {
          if (result.task !== null) deps.log({ event: 'run', at: at(), project: project.path, ...result.task });
        })
        .catch(logError)
        .finally(() => running.delete(project.path));
      running.set(project.path, work);
    }
    deps.onWait?.(working ? deps.now() + intervalMs : null);
    // A play or a pause cuts the wait short, so the person sees the change at once.
    await Promise.race([deps.sleep(intervalMs), ...(deps.control === undefined ? [] : [deps.control.changed()])]);
  }
  await Promise.all(running.values());
  deps.log({ event: 'stop', at: at() });
}
