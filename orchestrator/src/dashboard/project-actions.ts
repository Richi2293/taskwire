import { usageError } from '../errors.ts';
import { followProject, unfollowProject } from '../projects.ts';
import type { RunTaskwire } from '../taskwire.ts';

export interface ProjectActionDeps {
  home: string;
  runTaskwire: RunTaskwire;
  // Called with the project after a change, so the dashboard reads a project just followed at once.
  onChange: (project: string) => void;
}

const MAX_TEST_COMMAND = 1000;

// Following and unfollowing projects from the dashboard, with the same checks as "add" and "remove".
export function createProjectActions(deps: ProjectActionDeps): (body: unknown) => Promise<void> {
  return async (body) => {
    if (typeof body !== 'object' || body === null) throw usageError('The request must be a JSON object');
    const { action, project, testCommand } = body as Record<string, unknown>;
    if (typeof project !== 'string' || project.trim() === '') throw usageError('The request needs the "project" folder');
    if (action === 'follow') {
      if (testCommand !== undefined && (typeof testCommand !== 'string' || testCommand.length > MAX_TEST_COMMAND)) {
        throw usageError(`"testCommand" must be a string of at most ${MAX_TEST_COMMAND} characters`);
      }
      // The page sends an empty field when the person leaves it blank.
      const command = typeof testCommand === 'string' && testCommand.trim() !== '' ? testCommand : undefined;
      const entry = await followProject(deps, project, command);
      deps.onChange(entry.path);
    } else if (action === 'unfollow') {
      // The state lists only the projects in the config, so there is nothing to read again.
      unfollowProject(deps.home, project);
    } else {
      throw usageError(`Unknown action ${JSON.stringify(action)}`, 'Actions: follow, unfollow');
    }
  };
}
