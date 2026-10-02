import type { ProjectEntry } from './config.ts';
import type { CycleDeps } from './cycle.ts';
import { trackLive } from './live.ts';
import { processMerges } from './merging.ts';
import { processRelease } from './release.ts';

// What the orchestrator looks after in a project at every tick, besides agent work.
// Merges and releases change the repository, so they run only while agents may work there;
// recording live tasks only reads, so it runs paused too.
export async function upkeep(deps: CycleDeps, project: ProjectEntry, working: boolean): Promise<void> {
  const steps = working ? [processMerges, processRelease, trackLive] : [trackLive];
  for (const step of steps) {
    try {
      await step(deps, project);
    } catch (error) {
      deps.log?.({ event: 'error', at: new Date(deps.now()).toISOString(), project: project.path, error: error instanceof Error ? error.message : String(error) });
    }
  }
}
