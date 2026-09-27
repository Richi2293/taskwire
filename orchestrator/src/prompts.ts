import type { TaskSummary } from './taskwire.ts';

// The instructions for an agent working on one task unattended. The task itself, the project rules
// and the writing format come from taskwire and the project's AGENTS.md, so they stay in one place.
export function workPrompt(task: TaskSummary): string {
  return `You are working unattended: nobody will answer questions during this session.

Work only on task ${task.id} (${task.url}), "${task.name}". This folder is a git worktree created for this task, on a detached HEAD.

1. Run \`taskwire rules\` and \`taskwire task get ${task.id}\`, and follow them together with the project's AGENTS.md.
2. If the task needs a choice that is not yours to make, or you cannot do it, do not guess: mark it with \`taskwire task update ${task.id} --needs decision\`, ask your questions in a comment, and stop.
3. Otherwise create a branch as the project rules say, do the work, commit it, and open a pull request if the project rules ask for one.
4. Verify your work: run the tests and check each acceptance criterion you can check yourself.
5. At the end mark the task and move it to the status the project uses for work to check:
   - \`--needs review\` when everything is verified and only a review or a merge is missing;
   - \`--needs test\` when something can only be checked by hand, with the steps for a person in a comment.

Never merge, never move the task to a closed status, never work on other tasks.`;
}

// Sent in the same session when the agent stopped without marking the task.
export function markPrompt(task: TaskSummary): string {
  return `You stopped without marking task ${task.id}. Mark it now with \`taskwire task update ${task.id} --needs decision|test|review\`, and add a comment that says what was done and what a person must do next. Change nothing else.`;
}
