#!/usr/bin/env node
import { homedir } from 'node:os';
import { join } from 'node:path';
import { main } from './cli.ts';
import { runCommand } from './commands.ts';
import { loadConfig } from './config.ts';
import { createTaskwire } from './taskwire.ts';

const home = process.env.TASKWIRE_ORCHESTRATOR_HOME ?? join(homedir(), '.config', 'taskwire-orchestrator');

let taskwireCommand = 'taskwire';
try {
  taskwireCommand = loadConfig(home).taskwireCommand ?? taskwireCommand;
} catch {
  // A broken config is reported by the command itself.
}

// Ctrl+C (or SIGTERM) stops "start" from launching new work and cuts the wait between ticks short.
const stop = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => stop.abort());
const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    stop.signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });

process.exitCode = await main({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  home,
  stdout: process.stdout,
  stderr: process.stderr,
  runTaskwire: createTaskwire(taskwireCommand),
  runCommand,
  now: () => Date.now(),
  sleep,
  stopped: () => stop.signal.aborted,
});
