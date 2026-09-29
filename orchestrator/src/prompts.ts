import { DEFAULT_BLOCK_TAG, DEFAULT_START_STATUSES, DEFAULT_WORK_STATUS } from './config.ts';
import type { ProjectEntry } from './config.ts';
import type { TaskSummary } from './taskwire.ts';

// How many new tasks one analysis may propose, so the person is not flooded.
export const MAX_PROPOSALS = 5;
// How many tasks waiting for a test or a review one analysis checks, so a run stays short.
export const MAX_CHECKS = 5;
// Tag of every task the analysis creates. It stays after the person accepts or rejects the task, so the proposals can be found in the task system.
export const PROPOSED_TAG = 'agent-proposed';

// The instructions for the periodic analysis of a project: it tidies the tasks and proposes work, but writes no code
// and leaves every decision to the person. The fixed headings are read by the dashboard (see dashboard/sections.ts).
export function analysisPrompt(project: ProjectEntry): string {
  const blockTag = project.blockTag ?? DEFAULT_BLOCK_TAG;
  const startStatuses = (project.startStatuses ?? DEFAULT_START_STATUSES).join(', ');
  const workStatus = project.workStatus ?? DEFAULT_WORK_STATUS;
  return `You are analysing this project unattended: nobody will answer questions during this session. This folder is a git worktree on the latest default branch, made for this analysis.

The goal is a project whose tasks agents and the person can work on well. You do not write code in this session.

Every comment you write in this session gets, under its \`### Details\`, the line \`- **Source:** automatic analysis by the orchestrator, <today's date>\`, with the label and the text in the project language, so the person knows where it comes from.

1. Run \`taskwire rules\` and follow them, together with the project's AGENTS.md. Read the README, the AGENTS.md, the recent history (\`git log --oneline -30\`) and the tests, to understand where the project stands.
2. Read the open tasks with \`taskwire tasks\`. Leave alone the tasks with the tag \`${blockTag}\` and the tasks in the status "${workStatus}": a person or an agent is on them.
3. Review the tasks an agent could take next (status ${startStatuses}, no \`needs\` mark). For each one that is not ready, mark it with \`taskwire task update <id> --needs decision\` and comment with \`### Questions\` and \`### Proposal\`, as the rules say:
   - too vague to do without guessing: ask what is missing;
   - too big for one pull request: propose the subtasks under \`### Proposal\`, without creating them;
   - a duplicate, or work already done: say so, and propose to close it.
   Leave the clear tasks as they are.
4. Check the tasks that wait for a test or a review (\`taskwire tasks --needs test\` and \`--needs review\`), at most ${MAX_CHECKS}, oldest first. The rules say not to work on them: checking them is allowed here, changing their code is not. For each one, read it with its comments, find the work (the branch or the merge its comments name; check it out here with \`git checkout --detach\`), and check each acceptance criterion as a person would. Do not trust the earlier comments.
   - Every criterion verified, and the work is where the project conventions want it before a task is closed (for example merged): check the criteria in the description, set \`--needs review\` and add a comment with a \`### Ready to close\` section that says in one or two sentences what you verified and where the work is. Do not close the task.
   - Some criteria can only be checked by a person: leave the task as it is; if you verified something new, add a comment with \`### Checked\` and \`### By hand\`.
   - You found a problem: leave the mark as it is and describe the problem in a comment.
5. Propose new tasks only when they are clearly worth it (a bug, important code without tests, a TODO, a gap in what the project promises) and fewer than ${MAX_PROPOSALS} tasks are ready for an agent. Propose at most ${MAX_PROPOSALS} new tasks, none that repeats an open task. Create each one with \`taskwire task create\`, a full description as the rules say, \`--tag ${blockTag} --tag ${PROPOSED_TAG} --needs decision\`, and add a comment whose details open with a \`### Proposed task\` section that says in one or two sentences why it is worth doing. The tag \`${blockTag}\` keeps agents away until the person accepts the task; the tag \`${PROPOSED_TAG}\` tells it was proposed by an analysis: never remove the tag \`${PROPOSED_TAG}\`, and never add it to a task you did not create.
6. Never write code, commit, push, merge, delete a task, or move a task to a closed status.

Your final answer is for the person, in the project language: at most 3 short lines on what you found and what you changed.`;
}

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
