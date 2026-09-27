import type { TaskSummary } from './taskwire.ts';

// The instructions for an agent working on one task unattended. The task itself, the project rules
// and the writing format come from taskwire and the project's AGENTS.md, so they stay in one place.
export function workPrompt(task: TaskSummary): string {
  return `You are working unattended: nobody will answer questions during this session.

Work only on task ${task.id} (${task.url}), "${task.name}". This folder is a git worktree created for this task, on a detached HEAD.

1. Run \`taskwire rules\` and \`taskwire task get ${task.id}\`, and follow them together with the project's AGENTS.md.
2. If the task needs a choice that is not yours to make, or you cannot do it, do not guess: mark it with \`taskwire task update ${task.id} --needs decision\`, ask your questions in a comment (under \`### Questions\`, with your \`### Proposal\`, as the rules say), and stop.
3. Otherwise create a branch as the project rules say, do the work, commit it, and open a pull request if the project rules ask for one.
4. Verify your work: run the tests and check each acceptance criterion you can check yourself.
5. At the end mark the task and move it to the status the project uses for work to check:
   - \`--needs review\` when everything is verified and only a review or a merge is missing;
   - \`--needs test\` when something can only be checked by hand, with a comment that lists under \`### Checked\` what you verified and under \`### By hand\` the steps for a person.

Never merge, never move the task to a closed status, never work on other tasks.`;
}

// Sent in the same session when the agent stopped without marking the task.
export function markPrompt(task: TaskSummary): string {
  return `You stopped without marking task ${task.id}. Mark it now with \`taskwire task update ${task.id} --needs decision|test|review\`, and add a comment that says what was done and what a person must do next. Change nothing else.`;
}

// A separate agent that checks the author's work as a person would, without trusting the author's report.
export function verifyPrompt(task: TaskSummary): string {
  return `You are verifying the work another agent did on task ${task.id} (${task.url}), "${task.name}". You are working unattended: nobody will answer questions.

This folder is the worktree with that work. Do not trust the author's comments: check for yourself.

1. Run \`taskwire rules\` and \`taskwire task get ${task.id}\`.
2. Check each acceptance criterion as a person would: run the CLI, open the page in a headless browser, run the app in a simulator, whatever fits the project. Reading the code is not enough when the behaviour can be exercised.
3. Keep checked (\`- [x]\`) only the criteria you verified; uncheck a criterion that fails.
4. Do not change the code, do not commit, never merge, never move the task to a closed status.
5. Mark the task and add a comment with what you checked and how:
   - all verified: \`taskwire task update ${task.id} --needs review\`;
   - some criteria can only be checked by hand: \`taskwire task update ${task.id} --needs test\`, listing under \`### Checked\` what you verified and under \`### By hand\` the steps for a person, only for those criteria;
   - you found a problem: do not mark the task, describe the problem precisely in your final answer.
6. End your final answer with exactly one line: \`VERDICT: pass\` (all verified), \`VERDICT: manual\` (some criteria need a person) or \`VERDICT: fail\` (you found a problem).`;
}

// Sent to the author's session when the project tests fail after its work.
export function fixTestsPrompt(task: TaskSummary, testCommand: string, output: string): string {
  return `The project tests fail after your work on task ${task.id}. \`${testCommand}\` ended with:

\`\`\`
${output.trim()}
\`\`\`

Fix the cause, run the tests again, commit, and update the task mark and comment if needed.`;
}

// Sent to the author's session when the verifier found a problem.
export function fixFindingsPrompt(task: TaskSummary, findings: string): string {
  return `An independent check of your work on task ${task.id} found a problem:

${findings.trim()}

Fix it, run the tests, commit, and update the task mark and comment if needed.`;
}
