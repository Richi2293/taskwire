import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { RunCommand } from './commands.ts';
import { EXIT, OrchestratorError } from './errors.ts';

// Where the worktree of a task lives: outside the project, one folder per project and task.
export function worktreePath(home: string, project: string, taskId: string): string {
  return join(home, 'worktrees', `${basename(project)}-${basename(dirname(project))}`, taskId);
}

// A detached worktree on the latest remote default branch (or the current HEAD without a remote):
// the agent creates its branch there, following the project rules.
export async function createWorktree(run: RunCommand, project: string, path: string): Promise<void> {
  // A task sent back to the agent continues where it was, on its branch.
  if (existsSync(path)) {
    copyConfig(project, path);
    return;
  }
  // Offline or without a remote the fetch fails, and the worktree starts from what is already there.
  await run('git', ['fetch', '--quiet'], { cwd: project });
  const remote = await run('git', ['rev-parse', '--verify', '--quiet', 'origin/HEAD'], { cwd: project });
  const base = remote.code === 0 ? 'origin/HEAD' : 'HEAD';
  mkdirSync(dirname(path), { recursive: true });
  const added = await run('git', ['worktree', 'add', '--detach', path, base], { cwd: project });
  if (added.code !== 0) {
    throw new OrchestratorError(`git worktree add failed in ${project}: ${added.stderr.trim()}`, EXIT.external);
  }
  copyConfig(project, path);
}

// .taskwire.json is often kept out of git, and taskwire needs it in the worktree.
function copyConfig(project: string, path: string): void {
  const copy = join(path, '.taskwire.json');
  mkdirSync(path, { recursive: true });
  if (!existsSync(copy)) copyFileSync(join(project, '.taskwire.json'), copy);
}
