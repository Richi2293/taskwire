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

process.exitCode = await main({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  home,
  stdout: process.stdout,
  stderr: process.stderr,
  runTaskwire: createTaskwire(taskwireCommand),
  runCommand,
  now: () => Date.now(),
});
