import { execFile } from 'node:child_process';
import { EXIT, OrchestratorError } from './errors.ts';

// The fields of a task in the output of "taskwire tasks" that the orchestrator uses.
export interface TaskSummary {
  id: string;
  name: string;
  status: string;
  priority: string | null;
  tags: string[];
  needs: 'decision' | 'test' | 'review' | null;
  parent: string | null;
  url: string;
  // The tasks this one waits for; missing in taskwire 0.1.6 and older.
  blockedBy?: string[];
  // The list the task belongs to; its statuses tell which one closes the task.
  list?: { id: string; name: string };
  // When the task last changed, comments included; missing in older taskwire versions.
  updatedAt?: string;
}

// Runs a taskwire command in a project folder and returns its JSON output.
export type RunTaskwire = (args: string[], cwd: string) => Promise<unknown>;

// The orchestrator talks to taskwire only through its CLI, like any agent, so every taskwire check applies to it too.
export function createTaskwire(command: string): RunTaskwire {
  return (args, cwd) =>
    new Promise((resolve, reject) => {
      execFile(command, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          const exitCode = typeof error.code === 'number' ? error.code : EXIT.external;
          reject(new OrchestratorError(`taskwire ${args[0] ?? ''}: ${describeFailure(stderr, error.message)}`, exitCode));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new OrchestratorError(`taskwire ${args[0] ?? ''} did not print JSON`, EXIT.external));
        }
      });
    });
}

// The area of the project in a task list shared by several projects, from its .taskwire.json; null without one.
// "taskwire project" reads only the config file, so it costs no call to the task system.
export async function readArea(runTaskwire: RunTaskwire, path: string): Promise<string | null> {
  const info = await runTaskwire(['project'], path);
  if (typeof info === 'object' && info !== null && 'area' in info && typeof info.area === 'string') return info.area;
  return null;
}

// taskwire prints errors as a JSON line with "error" and an optional "hint".
function describeFailure(stderr: string, fallback: string): string {
  const line = stderr.trim().split('\n').at(-1) ?? '';
  try {
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed === 'object' && parsed !== null && 'error' in parsed && typeof parsed.error === 'string') {
      const hint = 'hint' in parsed && typeof parsed.hint === 'string' ? ` (${parsed.hint})` : '';
      return `${parsed.error}${hint}`;
    }
  } catch {
    // Not JSON: fall back to the process error below.
  }
  return line || fallback;
}
