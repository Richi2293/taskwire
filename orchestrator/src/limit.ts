import type { RunTaskwire } from './taskwire.ts';

// At most this many taskwire calls at once, across the dashboard and the loop, to stay under the API rate limit.
export const MAX_TASKWIRE_CALLS = 3;

// Wraps a taskwire runner so that calls beyond the limit wait for a free place, in order.
export function limitCalls(run: RunTaskwire, limit: number): RunTaskwire {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async (args, cwd) => {
    // A finished call hands its place straight to the next waiting one, so a new call cannot slip in between.
    if (running >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    else running += 1;
    try {
      return await run(args, cwd);
    } finally {
      const next = waiting.shift();
      if (next === undefined) running -= 1;
      else next();
    }
  };
}
