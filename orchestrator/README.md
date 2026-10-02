# taskwire-orchestrator (experimental)

Lets AI agents work on the tasks of your projects on their own, through taskwire, and leaves you only the decisions, the reviews and the checks a machine cannot make.

It is at an early stage and not published: run it from a clone of this repository. It follows only the projects you add, and talks to taskwire through its CLI, like any agent, so every taskwire check applies to it too.

## Commands

```
orchestrator/bin/taskwire-orchestrator add <folder> [--test-command <command>]
orchestrator/bin/taskwire-orchestrator remove <folder>
orchestrator/bin/taskwire-orchestrator list
orchestrator/bin/taskwire-orchestrator next
orchestrator/bin/taskwire-orchestrator run-once
orchestrator/bin/taskwire-orchestrator start
```

- `add` follows a project already set up with taskwire (it has a `.taskwire.json`). `--test-command` is the command that runs the project tests, from the project folder.
- `remove` stops following a project. Its folder, worktrees and tasks stay as they are. It is refused while an agent works in the project.
- `list` shows the projects it follows.

Projects can also be added and removed from the dashboard (see below).
- `next` shows, for each project, the task an agent would work on next. It changes nothing. A project with agents off shows `"agents": false` and no task, without reading its tasks.
- `run-once` makes one pass: for each project with agents on, an agent works on the next task (see below).
- `start` opens the dashboard and runs until you press Ctrl+C. It starts **paused**: no agent takes a task until you press **Start working** on the dashboard, and **Pause** stops new work while agents already at work finish their task. Every start begins paused. While working, every `intervalMinutes` (5 by default) it starts a pass on each project that is free (preceded by an analysis of the project when one is due, see below), with at most `maxAgents` agents at once (2 by default), never two on the same project and never two in the same group (see Projects that share a task list); pressing Start working starts the first pass at once. Projects take turns: the one that waited longest goes first, so each gets its chance. It reads the config at every tick, so a project added with `add` joins without a restart. It prints one JSON event per line (`dashboard`, `start`, `interrupted`, `play`, `pause`, `analysis`, `run`, `action`, `error`, `stop`); an error in a project is logged and the others go on. An `action` event tells which action the dashboard sent on which task and whether it was done, refused or failed, with the reason; it never contains the text you wrote, which is in the task comment. After Ctrl+C it starts nothing new and waits for the running passes.

## Dashboard

Open http://127.0.0.1:4777 (`dashboardPort` to change it) while `start` runs. One page, refreshed every 30 seconds, and every 3 seconds while the task system is being read:

- **Control bar:** a light bar under the name of the page. On the left, paused or working with a short hint; on the right, when the data was read from the task system ("Updated 2 minutes ago", or "Updating from ClickUp" with a spinner while a read runs), **Refresh**, **Details** and the Start agents or Pause button. Details opens what happens: which task an agent takes first, when the next check for new tasks is, and how many agents are in use out of `maxAgents`.
- **Projects:** one row per project, the projects of a group together, with its area (from taskwire, read only) and group, what waits for you (to decide, to try, to review), the agent at work, how many tasks ended today and what the last analysis found, or why the project could not be read. The **Agents** switch turns agents on or off for the project: off, no agent takes a new task there, an agent at work finishes its task, and what waits for you still shows in the queue. The choice is saved in the config (`agents`), so it stays after a restart. **Set group**, under More, changes the group of the project (see Projects that share a task list). **Remove project**, under More, stops following the project, like `remove`, after a confirmation in a modal. Under the name, a pill says who merges the project (**PR only**, **Auto to dev**, **Auto to main**, see Who merges); pressing it opens the choice in a modal, and **Auto to main** asks to type the project name, which the server checks too. With level `"main"`, a line says when the release to production waits or is blocked, and why.
- **Add project:** lists the taskwire projects (folders with a `.taskwire.json`) found in `projectRoots`, or, without it, in the folders that hold the projects already followed, up to three levels down. Hidden folders and `node_modules` are skipped, and the search never covers the whole home folder, since macOS would ask for access to Documents, Desktop and Downloads. **Add** follows a project with the same checks as `add`; a project that is not in the list can be added by pasting its path (`~/` works). The optional test command applies to the project you follow.
- **Waiting for you:** a compact queue grouped by kind, with filters. The project buttons above it narrow the queue to one or more projects (All projects shows them all again); the choice is kept in the browser, so it stays after a reload. A waiting chip in a project row, such as "2 to decide", shows only those tasks of that project. Select a task to see its detail next to the queue: the questions and the proposal of the agent for a decision, what the agents already checked and the steps by hand for a test, or the agent's note. These come from the fixed sections of the agent's comment (see `taskwire rules`); without them the page shows the part for people of the comment. After them, the group **Live, close it** (filter **To close**) lists the open tasks whose work reached production (see Live tasks), each with **Close the task** in its row.
- **Done recently:** the runs of `runs.jsonl`, by day.

Each task waiting for you has its actions, all done through taskwire:

- **Send answer** (a decision): adds your answer as a comment and clears the mark, so an agent takes the task up again; **Accept the proposal** does the same with "Go ahead with your proposal.";
- **It works** (a test by hand) or **Approve** (a review): clears the mark; merging and closing the task stay with you, unless the project has a merge level: then the orchestrator merges it (see Who merges);
- **Something is wrong** or **Request changes**: adds what the agent should fix as a comment, clears the mark and moves the task back to a start status; the agent continues in the same worktree and branch;
- **Keep agents away from this task**, under More: adds the block tag (`no-agent`);
- **Accept the task** (a task proposed by the analysis): clears the mark and removes the block tag, so an agent may take it; **Reject** closes it; both keep the tag `agent-proposed`;
- **Close the task** (a task the analysis found ready to close, or a live task): moves it to the closed status of its list (`closedStatus` to choose another).

Following and removing a project also need the token of the page, and so does the search, since it lists folders of the Mac. Each one is logged as an `action` event (`follow` or `unfollow`), without the test command. When agents are working, a project added from the dashboard or with `add` joins at the next check.

Your comments start with "Answer from the person, via the dashboard:", since they come from the same account as the agents. Before any action the dashboard reads the task again and refuses the action if the task no longer waits for that. The page does not refresh while you type or a More menu is open. A More menu closes with a click outside it, with Escape or when another one opens.

The page never waits for the task system: it always shows the last data read, and reads again in the background. To stay well under the rate limit of the free ClickUp plan (100 requests a minute):

- a project is read again only while someone looks at the page, and at most once a minute; with no page open, the dashboard reads nothing;
- a read takes one task list per project, and the detail of a waiting task (its last comment and goal) only when the task changed since the last read (its `updatedAt`, which a new comment changes too);
- an action reads again only the project it changed, and a task whose mark it cleared leaves the queue at once;
- at most 3 taskwire calls run at once, across the dashboard and the loop;
- the last data read is kept in `snapshot.json`, so after a restart the page shows it at once, with its age, while it reads again. A project whose read fails keeps its last data, with the reason.

It listens on 127.0.0.1 only and refuses requests for any other host name. Actions need a token that changes at every start and is only in the page. Task names and comments are shown as text, never as HTML.

## One pass

For each project, `run-once`:

1. picks the next task and moves it to `in progress` (`workStatus`);
2. creates a git worktree for it, outside the project, in `~/.config/taskwire-orchestrator/worktrees/`, on the latest remote default branch (or the current `HEAD` without a remote), and copies `.taskwire.json` into it;
3. runs Claude Code there without interaction (`claude -p`), with instructions to work only on that task, follow `taskwire rules` and the project's `AGENTS.md`, mark the task with `needs` for a person, and never merge or close it;
4. reads the task again: if the agent did not mark it, asks it once in the same session;
5. when the agent marked the work as done (`needs-review` or `needs-test`), checks it without trusting it:
   - runs the project `testCommand` in the worktree; if the tests fail, sends the output to the author once and runs them again;
   - starts a separate verifier agent that checks each acceptance criterion as a person would, keeps checked only what it verified, and marks the task `needs-review` (all verified) or `needs-test` (with steps for the criteria only a person can check);
   - if the verifier finds a problem, sends it to the author once, then runs the tests and the verifier again;
6. marks the task `needs-review` itself, with a comment, when something could not end well: no mark from the agent, a failed run, tests that still fail, a verifier with no verdict or still finding problems;
7. appends the run to `runs.jsonl` (task, times, every agent session with its cost, tests, verdict, outcome, worktree, branch, pull request, log) and keeps the whole output in `logs/` (see Diary and logs).

Before the first project, tasks left `in progress` by a pass that was cut short are marked `needs-review`. The worktrees stay after the run, so you can look at the work; the agent's branch lives in the project repository.

The orchestrator needs a taskwire with `needs` and areas (`taskwire project`, `--all-areas`): taskwire 0.1.7 or later. `taskwireCommand` can point to a clone to try an unreleased taskwire. The agent gets the same taskwire: the orchestrator links it in `~/.config/taskwire-orchestrator/bin/` and puts that folder first on the agent's `PATH`.

## Who merges

Each project sets who merges the work of its agents, with `merge` in the config:

- `"none"` (the default): the agent opens a pull request and a person merges it;
- `"dev"`: the orchestrator merges the verified tasks into the staging branch (`stagingBranch`, `dev` by default);
- `"main"`: the same, and then the orchestrator releases staging to production (see below).

A project without a staging branch sets `stagingBranch` to its production branch: the orchestrator then merges task pull requests straight into production, and there is no release step.

The agent never merges: the orchestrator does, with `gh pr merge --squash`, and only when all of these hold at the same moment:

- the verifier confirmed every acceptance criterion (a task left for a test by hand waits for the person);
- the task still waits for a review, so the person did not act on it meanwhile;
- the pull request is open, targets the staging branch and has no conflicts;
- its last commit is the one the tests and the verifier checked, with nothing left uncommitted in the worktree; the merge itself is pinned to that commit (`--match-head-commit`), so a push in the meantime stops it;
- its CI is green. The orchestrator waits at least 2 minutes after the task is queued, so a slower CI can register; without any check after 10 minutes, the task goes to the person. Without required status checks on GitHub, green means green among the checks registered so far.

Verified tasks wait in `merges.json`, and `start` looks at them at every tick while agents work, before new tasks start. `run-once` only queues them. A task the verifier could not check in full waits for the person: with a merge level, **It works** or **Approve** on the dashboard queue its merge, at the commit its last run ended on, when the verifier passed that run in full or but for the checks by hand (a run that failed its checks stays the person's to merge). The merge then needs the mark still clear, the task not sent back, no agent at work on it and nothing uncommitted in its worktree. Any other answer from the dashboard on the task withdraws a queued merge. After the merge the orchestrator clears the mark and comments with the pull request; it never closes the task. When a condition fails, the task goes to the person with the reason. Lowering the level to `"none"` stops the merges still queued.

After every pass, failed ones too, the orchestrator also looks at the pull request: if it was merged during the run, the agent merged it on its own. The task goes to the person, and agents are turned off for the project (`"agents": false`).

The orchestrator needs `gh`, logged in, on its PATH. It cannot stop an agent that has every permission from running `gh` itself: for a hard stop, protect the staging and production branches on GitHub (required reviews or required status checks).

### Release to production

With level `"main"`, at every tick while agents work, when staging is ahead of production (`productionBranch`, the default branch of the remote by default), the orchestrator:

1. waits while a task of the project (of its area, when it has one) waits for a test by hand;
2. opens a pull request from staging to production, `release: dev to main`, when there is none;
3. merges it with a merge commit, pinned to the staging commit, once its CI is green, it has no conflicts and the same staging commit has been there for 2 minutes.

Conflicts, a failed CI or no CI after 10 minutes block the release until the pull request changes, and a refused merge is tried again at the next tick; nothing is forced. Closing the release pull request stops the release until staging moves on. Where each project stands is kept in `releases.json`.

### Live tasks

At every tick, paused too, the orchestrator looks at the pull request of the latest run of each task of the last 30 days, at every merge level: when it is merged and its merge commit is in the production branch, the task is live and recorded in `live.json`, whoever merged and released it. The person then closes it; the orchestrator never does. A pull request closed without merging is not asked again, an open one at most every 30 minutes, and once merged only `git` checks whether its merge commit reached production. This only reads (`gh` and `git fetch`).

## Diary and logs

Everything the orchestrator does is kept in its folder, so a run can be understood afterwards, also by an agent:

- `events.jsonl`: the diary, one JSON event per line, written by `start` (the same events it prints) and by `run-once`. Besides the events of `start`, a run adds `claim` (a task taken), `agent` (an agent session ended: `role` author, nudge, fix-tests, fix-findings, verifier or analysis, `agent`, `sessionId`, `ok`, `costUsd`, `durationMs`), `tests` (command, result, exit code) `marked` (the orchestrator marked the task for a person, with the reason), `merge-queued`, `merge` and `merge-skipped` (a merge, with the pull request and the reason when it was skipped) `agent-merged` (an agent merged on its own), `release-opened`, `release-waiting`, `release-blocked` and `release` (where a release stands, one event when it changes) and `live` (a task whose work reached production);
- `runs.jsonl` and `analyses.jsonl`: one line per run or analysis, with its `sessions` and the path of its `log`;
- `logs/`: the whole output of every agent session of a run, each under a heading with its role, agent and session. With Claude Code it is the `stream-json` output, which holds every step of the session.

The fields of the diary and of the records do not depend on the agent CLI; only the content of `logs/` does. Logs and events older than 30 days are removed at every start.

## Permissions and sandbox

By default the agent runs with every permission (`--dangerously-skip-permissions`) inside its worktree, so it can push and open pull requests when the project rules ask for it.

With `"sandbox": true` the agent runs in the Claude Code sandbox (`--permission-mode auto`, no prompts): it cannot write outside the worktree and reaches only the task system API and the `allowedDomains` of the project. Checked on 2026-09-27 with Claude Code 2.1.283 on macOS:

- taskwire works in the sandbox, Keychain included, because the orchestrator sets `NODE_USE_ENV_PROXY=1`: the sandbox routes the network through a proxy, and Node's `fetch` uses it only with that variable;
- tests, branches and commits work;
- `git` over SSH and `gh` do not reach GitHub, even with `github.com` allowed or with `excludedCommands`: a sandboxed agent can only commit locally.

## Project analysis

In `start`, while agents work, an agent analyses each project with agents on: the first time the project is seen, then at most every `analysisHours` (1 by default, low while the analysis is tried out). A due analysis comes before the next task of the project, in the same slot, so the task picked next reflects it. It runs in its own worktree (`worktrees/<project>/analysis`), made again from the latest default branch every time, and writes no code. The agent:

1. reads the project (README, AGENTS.md, recent history, tests);
2. reviews the tasks an agent could take next: one that is too vague, too big or already done gets `needs decision`, with its questions and proposal, for at most 10 tasks per analysis, the most important first;
3. checks up to 5 tasks that wait for a test or a review, as a person would: when every criterion is verified and the work is where the project wants it (for example merged), it marks the task `needs review` with a `### Ready to close` section, and the dashboard offers **Close the task**; it never closes a task itself;
4. proposes at most 5 new tasks, only when they are clearly worth it and few tasks are ready: each gets the block tag, `needs decision` and a `### Proposed task` section, so no agent takes it until you accept it, and the tag `agent-proposed`, which stays after you accept or reject it, so the proposals can be found in the task system;
5. ends with a short summary for you, shown in the project row.

Every comment of the analysis has a "Source" line in its details (automatic analysis by the orchestrator, with the date), in the project language.

Each analysis is appended to `analyses.jsonl` (times, outcome, summary, cost, log), and a failed one is tried again only after `analysisHours`. `run-once` makes no analysis.

## Projects that share a task list

Several projects (for example the backend, the frontend and the app of one product) may share one task list. Each of them then gets an **area**, the tag of its tasks (`fe`, `be`, `mobile`), and a **group**, the product they belong to.

- The area lives in the project's `.taskwire.json`, so the agents and the CLI see the same one: set it with `taskwire area set <tag>` in the project. The orchestrator reads it with `taskwire project` and the dashboard shows it, read only.
- The group lives in the config of the orchestrator, since only the turns between agents need it: set it there or with **Set group**, under More in the project row.
- An `area` left in the config of the orchestrator, from before, stops it with the command to run in the project.

- An agent of a project with an area takes only the tasks with that tag. A task with no area tag is taken by no agent of the group, so no work lands in the wrong repository.
- A task that touches several areas becomes a container with one subtask per area, each with its tag. A dependency (`blocked by`) sets their order: a task that waits for an open task is not taken.
- The analysis leaves alone the tasks of the other areas. It adds the area tag to a task whose area is clear, asks when it is not, and proposes the subtasks of a task that touches several areas; once the person accepts, the next analysis creates them.
- The agent working on a task does only the part of its area, and says in its comment what the other areas must do.
- The orchestrator reads the tasks of every area (`taskwire tasks --all-areas`), so a task that waits for an open task of another area is not taken too early.
- On the dashboard, a project shows the tasks of its area. A task with none of the areas of the projects followed shows once, in the first project with an area of its group: no agent takes it, but it may wait for you, for example to say its area.
- One agent at a time works in a group, on a task or an analysis, even when `maxAgents` leaves room: the projects of a product often share local ports, databases and services, so two agents at once would get in each other's way when they run the tests. The projects of the group take turns; projects of other groups, or with no group, still work at the same time.

A project without an area takes every task, as before.

## Which task comes next

A task is picked when:

- its project has agents on (the default, see the Agents switch on the dashboard);
- its status is one of the start statuses of the project (`backlog` and `to do` by default);
- it does not wait for a person (no `needs` mark, see `taskwire task update --needs`);
- it does not have the block tag (`no-agent` by default), which keeps agents away from a task;
- it has no open subtasks, since the work is in the subtasks;
- it does not wait for an open task (`blocked by`);
- when the project has an area (see Projects that share a task list), it has the area tag.

Among those, the highest priority comes first, then the oldest task.

## Configuration

The config lives in `~/.config/taskwire-orchestrator/config.json` (set `TASKWIRE_ORCHESTRATOR_HOME` to use another folder). `add` writes it; you can also edit it by hand.

```json
{
  "taskwireCommand": "/path/to/taskwire/bin/taskwire",
  "maxAgents": 2,
  "intervalMinutes": 5,
  "projects": [
    { "path": "/Users/jane/code/website", "testCommand": "npm test", "startStatuses": ["to do"], "blockTag": "manual" }
  ]
}
```

| Field | Meaning |
|---|---|
| `maxAgents` | how many agents may work at once, across projects (default 2); a group counts as one |
| `intervalMinutes` | minutes between two looks at the projects in `start` (default 5) |
| `analysisHours` | hours between two analyses of the same project in `start` (default 1) |
| `dashboardPort` | port of the dashboard on 127.0.0.1 (default 4777) |
| `projectRoots` | absolute paths (`~/` works) where Add project looks for taskwire projects; defaults to the folders of the projects followed |
| `taskwireCommand` | the taskwire command to run; defaults to `taskwire` on the PATH. Point it to a clone to try an unreleased taskwire |
| `projects[].path` | absolute path of the project folder |
| `projects[].testCommand` | command that runs the project tests |
| `projects[].startStatuses` | statuses tasks are picked from |
| `projects[].blockTag` | tag that keeps agents away from a task |
| `projects[].workStatus` | status a task moves to when an agent takes it (default `in progress`) |
| `projects[].closedStatus` | status Close the task and Reject move a task to (default: the last status of the task's list) |
| `projects[].sandbox` | `true` to run agents in the Claude Code sandbox |
| `projects[].allowedDomains` | extra domains a sandboxed agent may reach |
| `projects[].group` | the product the project belongs to, with the other projects of its task list; the area of the project is in its `.taskwire.json` |
| `projects[].merge` | who merges: `"none"` a person (default), `"dev"` the orchestrator into staging, `"main"` staging and later production |
| `projects[].stagingBranch` | the staging branch the orchestrator merges into (default `dev`) |
| `projects[].productionBranch` | the production branch releases go to (default: the default branch of the remote) |
| `projects[].agents` | `false` keeps agents away from the project while it stays followed (default `true`) |

## Development

Same rules as taskwire (see [AGENTS.md](../AGENTS.md)): Node 24.7 or later, TypeScript run directly, no dependencies, `node --test` from the repository root runs these tests too.

### Design first

The dashboard is designed before it is coded. [`design/dashboard.pen`](design/dashboard.pen) holds its screens and states, one frame each (the whole dashboard, the control bar, the project rows and their More menu, the queue, the modals). It is a JSON file that opens in [Pencil](https://pen.dev), so its changes show in the diff of a pull request.

1. A change to the UI starts in the design: change the frames it touches, or add one for a new state.
2. Once the design is approved, it moves to the code in `src/dashboard/page.ts`, test first.
3. A change made in the code alone, such as a small fix, is brought back into the design, so the two stay alike.

The design follows the rules of the repository: neutral names (`website`, `shop`), texts in English, no em-dash or en-dash. On the page, a destructive action is red (the `danger` class), and every confirmation goes through the confirm modal (`askConfirm`), never the confirm of the browser.
